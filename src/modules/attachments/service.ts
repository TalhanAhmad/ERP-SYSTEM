import "server-only";
import { db } from "@/server/db";
import type { Actor } from "@/server/context";
import { audit, type Tx } from "@/server/transaction";
import { invariant } from "@/server/errors";
import { taskFor, visibleTasks } from "@/modules/tasks/service";
import { validateFile } from "./validation";
import { attachmentFields } from "./metadata";
import { fileStorage, fileDigest, type FileStorage } from "./storage";
import { z } from "zod";
async function lockActor(tx: Tx, actor: Actor) {
  await tx.$queryRaw`SELECT id FROM "Person" WHERE id=${actor.id}::uuid FOR UPDATE`;
  const current = await tx.person.findUnique({ where: { id: actor.id } });
  invariant(
    current?.status === "ACTIVE",
    "ACCOUNT_INACTIVE",
    "This account is not active.",
    403,
  );
  invariant(
    current.role === actor.role,
    "PERMISSIONS_CHANGED",
    "Permissions changed; reload and retry.",
    409,
  );
}
async function editableTask(tx: Tx, actor: Actor, taskId: string) {
  const { task } = await taskFor(tx, actor, taskId);
  invariant(
    task.assigneeId === actor.id,
    "FORBIDDEN",
    "Only the assignee can upload or remove draft files.",
    403,
  );
  invariant(
    ["IN_PROGRESS", "CHANGES_REQUESTED"].includes(task.status),
    "INVALID_TRANSITION",
    "Files can be changed while work is in progress or changes are requested.",
    409,
  );
  return task;
}
const dto = (file: {
  id: string;
  fileName: string;
  mimeType: string;
  byteSize: number;
  status: string;
  createdAt: Date;
}) => ({
  id: file.id,
  fileName: file.fileName,
  mimeType: file.mimeType,
  byteSize: file.byteSize,
  status: file.status,
  createdAt: file.createdAt,
});
export async function uploadAttachment(
  actor: Actor,
  taskId: string,
  key: string,
  fileName: string,
  mimeType: string,
  body: Uint8Array,
  storage: FileStorage = fileStorage,
) {
  z.uuid().parse(taskId);
  z.string().min(8).max(128).parse(key);
  const metadata = validateFile(fileName, mimeType, body),
    sha256 = fileDigest(body),
    attemptId = crypto.randomUUID();
  const reservation = await db.$transaction(
    async (tx) => {
      await lockActor(tx, actor);
      const { task } = await taskFor(tx, actor, taskId);
      invariant(
        task.assigneeId === actor.id,
        "FORBIDDEN",
        "Only the assignee can upload files.",
        403,
      );
      const existing = await tx.attachment.findUnique({
        where: {
          taskId_uploaderId_uploadKey: {
            taskId,
            uploaderId: actor.id,
            uploadKey: key,
          },
        },
      });
      if (existing) {
        invariant(
          existing.sha256 === sha256 &&
            existing.fileName === metadata.fileName &&
            existing.mimeType === mimeType,
          "IDEMPOTENCY_CONFLICT",
          "This upload key was used for different file contents or metadata.",
          409,
        );
        if (["READY", "ATTACHED"].includes(existing.status)) return existing;
        invariant(
          existing.status === "PENDING",
          "UPLOAD_CLOSED",
          "This file upload has been removed.",
          409,
        );
        invariant(
          !existing.leaseUntil || existing.leaseUntil <= new Date(),
          "UPLOAD_BUSY",
          "This file is being uploaded. Retry shortly.",
          409,
        );
      }
      await editableTask(tx, actor, taskId);
      if (!existing) {
        invariant(
          (await tx.attachment.count({
            where: { taskId, status: { not: "DELETED" } },
          })) < 100,
          "FILE_LIMIT",
          "This task has reached its file limit.",
          409,
        );
        invariant(
          (await tx.attachment.count({
            where: {
              taskId,
              uploaderId: actor.id,
              status: { in: ["PENDING", "READY", "DELETING"] },
            },
          })) < 10,
          "FILE_LIMIT",
          "Use or remove a draft file before uploading another (10 drafts maximum).",
          409,
        );
      }
      const leaseUntil = new Date(Date.now() + 120000);
      if (existing)
        return tx.attachment.update({
          where: { id: existing.id },
          data: { attemptId, leaseUntil },
        });
      const id = crypto.randomUUID();
      return tx.attachment.create({
        data: {
          id,
          taskId,
          uploaderId: actor.id,
          ...metadata,
          byteSize: body.byteLength,
          sha256,
          storageKey: `tasks/${taskId}/${id}`,
          uploadKey: key,
          attemptId,
          leaseUntil,
        },
      });
    },
    { timeout: 10000 },
  );
  if (["READY", "ATTACHED"].includes(reservation.status))
    return dto(reservation);
  try {
    await storage.put(reservation.storageKey, body, mimeType);
    return await db.$transaction(async (tx) => {
      await lockActor(tx, actor);
      await editableTask(tx, actor, taskId);
      const file = await tx.attachment.findUniqueOrThrow({
        where: { id: reservation.id },
      });
      invariant(
        file.status === "PENDING" && file.attemptId === attemptId,
        "UPLOAD_CHANGED",
        "This file upload changed; reload and retry.",
        409,
      );
      const ready = await tx.attachment.update({
        where: { id: file.id },
        data: { status: "READY", leaseUntil: null },
      });
      await audit(tx, actor.id, "ATTACHMENT_UPLOADED", file.id, {
        taskId,
        byteSize: file.byteSize,
        mimeType,
      });
      return dto(ready);
    });
  } catch (error) {
    await db.attachment.updateMany({
      where: { id: reservation.id, attemptId, status: "PENDING" },
      data: { leaseUntil: null },
    });
    throw error;
  }
}
export async function listDraftAttachments(actor: Actor, taskId: string) {
  return db.attachment.findMany({
    where: {
      taskId,
      uploaderId: actor.id,
      status: { in: ["PENDING", "READY", "DELETING"] },
      task: visibleTasks(actor),
    },
    select: attachmentFields,
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
}
async function readableAttachment(actor: Actor, id: string) {
  const current = await db.person.findUnique({ where: { id: actor.id } });
  invariant(
    current?.status === "ACTIVE",
    "ACCOUNT_INACTIVE",
    "This account is not active.",
    403,
  );
  const file = await db.attachment.findFirst({
    where: {
      id,
      status: { in: ["READY", "ATTACHED"] },
      task: visibleTasks(current),
      OR: [{ status: "ATTACHED" }, { uploaderId: current.id }],
    },
  });
  invariant(file, "NOT_FOUND", "File not found.", 404);
  return file;
}
export async function downloadAttachment(
  actor: Actor,
  id: string,
  storage: FileStorage = fileStorage,
) {
  const file = await readableAttachment(actor, z.uuid().parse(id));
  const bytes = await storage.get(file.storageKey);
  // Recheck account/project access after provider I/O, including deactivation.
  await readableAttachment(actor, id);
  invariant(
    bytes.byteLength === file.byteSize && fileDigest(bytes) === file.sha256,
    "FILE_INTEGRITY",
    "File verification failed. Contact an administrator.",
    503,
  );
  return { file: dto(file), bytes };
}
export async function removeDraftAttachment(
  actor: Actor,
  id: string,
  storage: FileStorage = fileStorage,
) {
  z.uuid().parse(id);
  const file = await db.$transaction(async (tx) => {
    await lockActor(tx, actor);
    const found = await tx.attachment.findUnique({ where: { id } });
    invariant(
      found && found.uploaderId === actor.id,
      "NOT_FOUND",
      "File not found.",
      404,
    );
    await editableTask(tx, actor, found.taskId);
    invariant(
      found.status !== "ATTACHED",
      "IMMUTABLE_FILE",
      "Submitted files are preserved with their revision.",
      409,
    );
    invariant(
      !found.leaseUntil || found.leaseUntil <= new Date(),
      "UPLOAD_BUSY",
      "This file is being uploaded. Retry shortly.",
      409,
    );
    if (found.status !== "DELETED")
      await tx.attachment.update({
        where: { id },
        data: { status: "DELETING" },
      });
    return found;
  });
  await storage.remove(file.storageKey);
  await db.$transaction(async (tx) => {
    const changed = await tx.attachment.updateMany({
      where: { id, status: "DELETING" },
      data: { status: "DELETED", leaseUntil: null },
    });
    if (changed.count)
      await audit(tx, actor.id, "ATTACHMENT_REMOVED", id, {
        taskId: file.taskId,
      });
  });
  return { id, status: "DELETED" };
}
