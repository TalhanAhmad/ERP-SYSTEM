import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";
import { db } from "@/server/db";
import type { Actor } from "@/server/context";
import type { Prisma } from "@/generated/prisma/client";
import { AppError, invariant } from "@/server/errors";
import { fileDigest } from "@/modules/attachments/storage";
import { requireFinanceEnabled, withFinanceAccess } from "../../access/policy";
import { consumeFinanceProof, type FinanceProof } from "../../access/reauth";
import { financeStorage, type FinanceStorage } from "./storage";
import {
  financeScanner,
  scanResultSchema,
  type FinanceScanner,
} from "./scanner";
import {
  reserveFileSchema,
  fileIntentSchema,
  sourceSchema,
  validateFinanceBytes,
} from "./validation";
export const intentDigest = (token: string) =>
  createHash("sha256").update(token).digest("hex");
const publicSelect = {
  id: true,
  fileName: true,
  mimeType: true,
  byteSize: true,
  sha256: true,
  state: true,
  version: true,
  invoiceId: true,
  billId: true,
  customerDocumentId: true,
  supplierDocumentId: true,
  journalDraftId: true,
  movementId:true,
  scanResult: true,
  createdAt: true,
  blobDeletedAt: true,
  uploader: { select: { displayName: true } },
  customerDocument: { select: { kind: true } },
  supplierDocument: { select: { kind: true } },
} as const;
const errors: Record<string, string> = {
  FINANCE_FILE_SIGNATURE:
    "The scanner result could not be verified. Evidence stays quarantined.",
  FINANCE_FILE_LIMIT:
    "This document has ten active evidence files. Remove an abandoned draft file first.",
  FINANCE_FILE_RETAINED:
    "Posted evidence is retained. Only draft evidence can be removed; completed scans cannot be overwritten.",
  FINANCE_FILE_INTENT:
    "This upload authorization expired or changed. Verify your password again to retry.",
  FINANCE_IDEMPOTENCY_CONFLICT:
    "This key was used for different evidence. Select the original file or start a new upload.",
  FINANCE_NOT_FOUND: "Evidence or source unavailable.",
  FINANCE_FORBIDDEN: "Finance access is unavailable.",
  FINANCE_REAUTH_REQUIRED: "Verify your password and authenticator again.",
  FINANCE_INVALID_INPUT: "Check the evidence metadata and document reference.",
};
type Evidence = { provider: string; sessionId: string; verifiedAt: Date };
async function checked(
  actor: Pick<Actor, "id">,
  evidence: Evidence | undefined,
  action: string,
  input: unknown,
  key = crypto.randomUUID(),
  requestId = crypto.randomUUID(),
) {
  try {
    const rows = await db.$queryRaw<
      { result: { id: string } }[]
    >`SELECT public.encova_finance_file_command(${actor.id}::uuid,${evidence?.provider ?? null},${evidence?.sessionId ?? null},${evidence?.verifiedAt ?? null}::timestamptz,${action},${JSON.stringify(input)}::jsonb,${key},${requestId}::uuid) AS result`;
    return rows[0].result;
  } catch (e) {
    const code = (
      e as {
        meta?: {
          driverAdapterError?: { cause?: { originalMessage?: string } };
        };
      }
    ).meta?.driverAdapterError?.cause?.originalMessage;
    if (code && errors[code])
      throw new AppError(
        code,
        errors[code],
        code === "FINANCE_NOT_FOUND"
          ? 404
          : [
                "FINANCE_FORBIDDEN",
                "FINANCE_FILE_INTENT",
                "FINANCE_REAUTH_REQUIRED",
              ].includes(code)
            ? 403
            : 409,
      );
    throw e;
  }
}
export async function fileDetail(actor: Pick<Actor, "id">, id: string) {
  return withFinanceAccess(actor, async (tx) => {
    const file = await tx.financeFile.findUnique({
      where: { id: z.uuid().parse(id) },
      select: publicSelect,
    });
    invariant(file, "FINANCE_NOT_FOUND", "Evidence unavailable.", 404);
    return {
      ...file,
      createdAt: file.createdAt.toISOString(),
      blobDeletedAt: file.blobDeletedAt?.toISOString() ?? null,
    };
  });
}
async function internalFile(actor: Pick<Actor, "id">, id: string) {
  return withFinanceAccess(actor, async (tx) => {
    const file = await tx.financeFile.findUnique({
      where: { id: z.uuid().parse(id) },
    });
    invariant(file, "FINANCE_NOT_FOUND", "Evidence unavailable.", 404);
    return file;
  });
}
function requestKey(key: string | null) {
  invariant(
    key && key.length >= 8 && key.length <= 128,
    "IDEMPOTENCY_REQUIRED",
    "Provide an Idempotency-Key of 8–128 characters.",
    400,
  );
  return key;
}
export async function reserveFile(
  actor: Pick<Actor, "id">,
  proof: FinanceProof,
  input: unknown,
  key: string | null,
  storage: FinanceStorage = financeStorage,
) {
  requireFinanceEnabled();
  key = requestKey(key);
  const body = reserveFileSchema.parse(input),
    evidence = consumeFinanceProof(proof, actor.id, "files:RESERVE:" + key),
    intent = randomBytes(32).toString("hex");
  const result = await checked(
      actor,
      evidence,
      "RESERVE",
      { ...body, intentHash: intentDigest(intent) },
      key,
    ),
    file = await internalFile(actor, result.id);
  if (!["RESERVED", "QUARANTINED"].includes(file.state))
    return {
      file: await fileDetail(actor, file.id),
      intent: null,
      uploadUrl: null,
    };
  // Separate bounded upload capability; it conveys no read permission. Download always proxies current access.
  const uploadUrl =
    file.state === "RESERVED"
      ? await storage.signedUpload(file.objectKey)
      : null;
  await fileDetail(actor, file.id);
  return { file: await fileDetail(actor, file.id), intent, uploadUrl };
}
async function verifyBytes(
  actor: Pick<Actor, "id">,
  id: string,
  storage: FinanceStorage,
) {
  const file = await internalFile(actor, id),
    bytes = await storage.get(file.objectKey);
  validateFinanceBytes(file, bytes, fileDigest);
  return { file, bytes };
}
export async function completeFile(
  actor: Pick<Actor, "id">,
  input: unknown,
  storage: FinanceStorage = financeStorage,
) {
  const { id, intent } = fileIntentSchema.parse(input);
  await checked(actor, undefined, "VALIDATE", {
    id,
    intentHash: intentDigest(intent),
  });
  const { file } = await verifyBytes(actor, id, storage);
  invariant(
    file.intentActorId === actor.id && file.intentHash === intentDigest(intent),
    "FINANCE_FILE_INTENT",
    "Upload authorization changed.",
    403,
  );
  await checked(actor, undefined, "COMPLETE", {
    id,
    intentHash: intentDigest(intent),
  });
  return fileDetail(actor, id);
}
export async function scanFile(
  actor: Pick<Actor, "id">,
  input: unknown,
  storage: FinanceStorage = financeStorage,
  scanner: FinanceScanner = financeScanner,
) {
  const { id, intent } = fileIntentSchema.parse(input);
  await checked(actor, undefined, "VALIDATE", {
    id,
    intentHash: intentDigest(intent),
  });
  const { file, bytes } = await verifyBytes(actor, id, storage);
  invariant(
    file.intentActorId === actor.id &&
      file.intentHash === intentDigest(intent) &&
      file.intentVerifiedAt.getTime() > Date.now() - 300000,
    "FINANCE_FILE_INTENT",
    "Verify your password again to retry scanning.",
    403,
  );
  if (["CLEAN", "REJECTED"].includes(file.state))
    return { file: await fileDetail(actor, id), scanPending: false };
  invariant(
    file.state === "QUARANTINED",
    "FINANCE_FILE_QUARANTINE",
    "Complete the upload before scanning.",
    409,
  );
  const result = await scanner(
    bytes,
    file.sha256,
    file.mimeType,
    file.id,
    intentDigest(intent),
  );
  await fileDetail(actor, id);
  if (!result) return { file: await fileDetail(actor, id), scanPending: true };
  const scan = scanResultSchema.parse(result);
  invariant(
    scan.sha256 === file.sha256,
    "FINANCE_FILE_INTEGRITY",
    "Scanner digest does not match this file.",
    409,
  );
  await checked(actor, undefined, "SCAN", {
    id,
    intentHash: intentDigest(intent),
    scanResult: scan,
  });
  return { file: await fileDetail(actor, id), scanPending: false };
}
export async function retryFileScan(
  actor: Pick<Actor, "id">,
  proof: FinanceProof,
  input: unknown,
  key: string | null,
  storage: FinanceStorage = financeStorage,
  scanner: FinanceScanner = financeScanner,
) {
  requireFinanceEnabled();
  key = requestKey(key);
  const body = z
      .object({ id: z.uuid(), reason: z.string().trim().min(3).max(500) })
      .strict()
      .parse(input),
    evidence = consumeFinanceProof(proof, actor.id, "files:SCAN:" + key),
    intent = randomBytes(32).toString("hex");
  await checked(
    actor,
    evidence,
    "AUTHORIZE",
    { ...body, intentHash: intentDigest(intent) },
    key,
  );
  const file = await internalFile(actor, body.id);
  if (file.state === "RESERVED")
    await completeFile(actor, { id: body.id, intent }, storage);
  return scanFile(actor, { id: body.id, intent }, storage, scanner);
}
export async function removeFile(
  actor: Pick<Actor, "id">,
  proof: FinanceProof,
  input: unknown,
  key: string | null,
  storage: FinanceStorage = financeStorage,
) {
  requireFinanceEnabled();
  key = requestKey(key);
  const body = z
      .object({ id: z.uuid(), reason: z.string().trim().min(3).max(500) })
      .strict()
      .parse(input),
    evidence = consumeFinanceProof(proof, actor.id, "files:REMOVE:" + key);
  await checked(actor, evidence, "REMOVE", body, key);
  const file = await internalFile(actor, body.id);
  let cleanupPending = true;
  try {
    await storage.remove(file.objectKey);
    await checked(actor, evidence, "BLOB_REMOVED", body, key);
    cleanupPending = false;
  } catch {}
  return { file: await fileDetail(actor, body.id), cleanupPending };
}
export const FILE_CHUNK_BYTES = 3 * 1024 * 1024;
export async function downloadFile(
  actor: Pick<Actor, "id">,
  id: string,
  range: string | null,
  storage: FinanceStorage = financeStorage,
) {
  const file = await internalFile(actor, id);
  invariant(
    file && file.state === "CLEAN",
    "FINANCE_FILE_UNAVAILABLE",
    "Evidence is unavailable until its security scan passes.",
    404,
  );
  let start = 0,
    end = file.byteSize - 1,
    partial = false;
  if (range) {
    const m = /^bytes=(0|[1-9][0-9]*)-(0|[1-9][0-9]*)$/.exec(range);
    invariant(m, "FILE_RANGE", "Use one bounded byte range.", 416);
    start = Number(m[1]);
    end = Math.min(Number(m[2]), end);
    partial = true;
  }
  invariant(
    Number.isSafeInteger(start) &&
      Number.isSafeInteger(end) &&
      start <= end &&
      end < file.byteSize &&
      end - start + 1 <= FILE_CHUNK_BYTES,
    "FILE_RANGE",
    "Use the evidence download button for this file.",
    416,
  );
  // Bounded responses stay below Vercel's payload limit. Every range request rechecks current access.
  const bytes = await storage.get(file.objectKey);
  validateFinanceBytes(file, bytes, fileDigest);
  return withFinanceAccess(actor, async (tx) => {
    const current = await tx.financeFile.findUnique({
      where: { id: file.id },
      select: { state: true },
    });
    invariant(
      current?.state === "CLEAN",
      "FINANCE_FILE_UNAVAILABLE",
      "Evidence is unavailable.",
      404,
    );
    return {
      file: {
        fileName: file.fileName,
        mimeType: file.mimeType,
        byteSize: file.byteSize,
        sha256: file.sha256,
      },
      bytes: bytes.slice(start, end + 1),
      start,
      end,
      partial,
    };
  });
}
export const filesQuerySchema = z
  .object({
    q: z.string().trim().max(100).default(""),
    state: z
      .enum([
        "ALL",
        "ACTIVE",
        "RESERVED",
        "QUARANTINED",
        "CLEAN",
        "REJECTED",
        "REMOVED",
      ])
      .default("ALL"),
    sourceType: sourceSchema.shape.sourceType.optional(),
    sourceId: z.uuid().optional(),
    page: z.coerce.number().int().min(1).max(10000).default(1),
  })
  .strict()
  .refine(
    (d) => !!d.sourceType === !!d.sourceId,
    "Specify source type and ID together.",
  );
export async function files(actor: Pick<Actor, "id">, input: unknown = {}) {
  return withFinanceAccess(actor, async (tx) => {
    const q = filesQuerySchema.parse(input),
      fields = {
        INVOICE: "invoiceId",
        BILL: "billId",
        CUSTOMER_DOCUMENT: "customerDocumentId",
        SUPPLIER_DOCUMENT: "supplierDocumentId",
        JOURNAL_DRAFT: "journalDraftId",
        MOVEMENT:"movementId",
      };
    const where: Prisma.FinanceFileWhereInput = {
      ...(q.state === "ACTIVE"
        ? { state: { not: "REMOVED" } }
        : q.state !== "ALL"
          ? { state: q.state }
          : {}),
      ...(q.sourceType ? { [fields[q.sourceType]]: q.sourceId } : {}),
      fileName: { contains: q.q, mode: "insensitive" },
    };
    const total = await tx.financeFile.count({ where }),
      pages = Math.max(1, Math.ceil(total / 25)),
      page = Math.min(q.page, pages);
    return {
      items: (
        await tx.financeFile.findMany({
          where,
          select: publicSelect,
          orderBy: [{ createdAt: "desc" }, { id: "asc" }],
          skip: (page - 1) * 25,
          take: 25,
        })
      ).map((file) => ({
        ...file,
        createdAt: file.createdAt.toISOString(),
        blobDeletedAt: file.blobDeletedAt?.toISOString() ?? null,
      })),
      total,
      page,
      pages,
      filters: q,
    };
  });
}
export async function cleanupRemovedFile(
  actor: Pick<Actor, "id">,
  proof: FinanceProof,
  id: string,
  reason: string,
  key: string,
  storage: FinanceStorage = financeStorage,
) {
  requireFinanceEnabled();
  requestKey(key);
  z.uuid().parse(id);
  z.string().trim().min(3).max(500).parse(reason);
  const evidence = consumeFinanceProof(proof, actor.id, "files:CLEANUP:" + key),
    file = await internalFile(actor, id);
  invariant(
    file.state === "REMOVED",
    "FINANCE_FILE_RETAINED",
    "Only a removal already recorded can be cleaned up.",
    409,
  );
  await storage.remove(file.objectKey);
  await checked(actor, evidence, "BLOB_REMOVED", { id, reason }, key);
  return fileDetail(actor, id);
}
