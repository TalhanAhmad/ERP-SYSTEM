import "dotenv/config";
import { beforeAll, afterAll, it, expect, vi } from "vitest";
import {
  startStorageFixture,
  STORAGE_FIXTURE_KEY,
} from "../helpers/storage-fixture";
const url =
  process.env.TEST_DATABASE_URL ??
  "postgresql://encova:local_only@localhost:55432/encova_test";
if (new URL(url).pathname !== "/encova_test")
  throw new Error("Dedicated test database required");
vi.stubEnv("DATABASE_URL", url);
const fixture = await startStorageFixture();
vi.stubEnv("SUPABASE_URL", fixture.url);
vi.stubEnv("SUPABASE_PUBLISHABLE_KEY", "synthetic-publishable-key");
vi.stubEnv("SUPABASE_SECRET_KEY", STORAGE_FIXTURE_KEY);
const { db } = await import("@/server/db");
const { uploadAttachment, downloadAttachment, removeDraftAttachment } =
  await import("@/modules/attachments/service");
const { fileStorage } = await import("@/modules/attachments/storage");
const { submit, review, listTasks } = await import("@/modules/tasks/service");
const { mutate } = await import("@/server/transaction");
type Actor = Awaited<ReturnType<typeof db.person.create>>;
let owner: Actor, reviewer: Actor, outsider: Actor;
const content = new TextEncoder().encode("Synthetic private work attachment ✓");
beforeAll(async () => {
  const suffix = crypto.randomUUID().slice(0, 8);
  [owner, reviewer, outsider] = await Promise.all(
    ["owner", "reviewer", "outsider"].map((name) =>
      db.person.create({
        data: {
          username: `file.${name}.${suffix}`,
          email: `file.${name}.${suffix}@example.test`,
          displayName: name,
          status: "ACTIVE",
        },
      }),
    ),
  );
});
afterAll(async () => {
  await fixture.close();
  await db.$disconnect();
  vi.unstubAllEnvs();
});
async function task() {
  const p = await db.project.create({
    data: {
      name: "File fixture",
      description: "Synthetic only",
      managerId: owner.id,
      members: { create: [{ userId: owner.id }, { userId: reviewer.id }] },
    },
  });
  return db.task.create({
    data: {
      projectId: p.id,
      assigneeId: owner.id,
      reviewerId: reviewer.id,
      title: "Private files",
      description: "Synthetic",
      status: "IN_PROGRESS",
    },
  });
}
const upload = (id: string, key = crypto.randomUUID(), actor = owner) =>
  uploadAttachment(actor, id, key, "report.txt", "text/plain", content);
const submitFiles = (id: string, ids: string[], version = 1) =>
  mutate(owner, "submit-files", crypto.randomUUID(), { ids, version }, (tx) =>
    submit(tx, owner, id, {
      expectedVersion: version,
      summary: "Work with attachments",
      artifactLinks: [],
      attachmentIds: ids,
    }),
  );
it("uploads through the real Storage SDK and replays without overwriting bytes", async () => {
  const t = await task(),
    key = crypto.randomUUID();
  const first = await upload(t.id, key);
  expect(first.status).toBe("READY");
  expect(await upload(t.id, key)).toEqual(first);
  expect(first).not.toHaveProperty("storageKey");
  expect(first).not.toHaveProperty("sha256");
  expect((await downloadAttachment(owner, first.id)).bytes).toEqual(content);
  await expect(
    uploadAttachment(
      owner,
      t.id,
      key,
      "report.txt",
      "text/plain",
      new TextEncoder().encode("different"),
    ),
  ).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
});
it("recovers ambiguous provider writes only when the stored bytes match", async () => {
  const t = await task();
  fixture.state.failAfterWrite = true;
  const file = await upload(t.id);
  expect(file.status).toBe("READY");
  const row = await db.attachment.findUniqueOrThrow({ where: { id: file.id } });
  fixture.objects.set(`encova-private/${row.storageKey}`, {
    bytes: Buffer.from("tampered"),
    mime: "text/plain",
  });
  await expect(
    fileStorage.put(row.storageKey, content, "text/plain"),
  ).rejects.toMatchObject({ code: "STORAGE_UNAVAILABLE" });
  await expect(downloadAttachment(owner, file.id)).rejects.toMatchObject({
    code: "FILE_INTEGRITY",
  });
});
it("denies outsiders and other members access to drafts, then allows submitted history", async () => {
  const t = await task(),
    file = await upload(t.id);
  await expect(
    upload(t.id, crypto.randomUUID(), outsider),
  ).rejects.toMatchObject({ code: "NOT_FOUND" });
  await expect(
    upload(t.id, crypto.randomUUID(), reviewer),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
  await expect(downloadAttachment(reviewer, file.id)).rejects.toMatchObject({
    code: "NOT_FOUND",
  });
  await expect(downloadAttachment(outsider, file.id)).rejects.toMatchObject({
    code: "NOT_FOUND",
  });
  await submitFiles(t.id, [file.id]);
  expect((await downloadAttachment(reviewer, file.id)).bytes).toEqual(content);
  const listed = JSON.stringify(await listTasks(reviewer));
  expect(listed).toContain(file.fileName);
  expect(listed).not.toContain("storageKey");
  expect(listed).not.toContain("sha256");
});
it("rejects cross-task and unfinished files without creating a submission", async () => {
  const first = await task(),
    second = await task(),
    file = await upload(first.id);
  await expect(submitFiles(second.id, [file.id])).rejects.toMatchObject({
    code: "INVALID_ATTACHMENTS",
  });
  expect(await db.submission.count({ where: { taskId: second.id } })).toBe(0);
});
it("preserves submitted file bytes/metadata across revisions and enforces database immutability", async () => {
  const t = await task(),
    first = await upload(t.id);
  const submission = (await submitFiles(t.id, [first.id])) as { id: string };
  await mutate(
    reviewer,
    "request-file-changes",
    crypto.randomUUID(),
    {},
    (tx) =>
      review(tx, reviewer, submission.id, {
        expectedVersion: 2,
        decision: "REQUEST_CHANGES",
        feedback: "Another revision",
      }),
  );
  const second = await upload(t.id);
  await submitFiles(t.id, [second.id], 3);
  await expect(
    db.attachment.update({
      where: { id: first.id },
      data: { fileName: "changed.txt" },
    }),
  ).rejects.toThrow();
  await expect(
    db.attachment.delete({ where: { id: first.id } }),
  ).rejects.toThrow();
  expect((await downloadAttachment(reviewer, first.id)).bytes).toEqual(content);
  expect(
    await db.attachment.count({ where: { taskId: t.id, status: "ATTACHED" } }),
  ).toBe(2);
});
it("serializes concurrent uploads and performs provider I/O outside the database transaction", async () => {
  const t = await task(),
    key = crypto.randomUUID();
  let entered!: () => void, release!: () => void;
  const started = new Promise<void>((r) => (entered = r)),
    wait = new Promise<void>((r) => (release = r));
  const uploadPromise = uploadAttachment(
    owner,
    t.id,
    key,
    "report.txt",
    "text/plain",
    content,
    {
      ...fileStorage,
      put: async (k, bytes, mime) => {
        expect(
          await db.attachment.count({
            where: { taskId: t.id, status: "PENDING" },
          }),
        ).toBe(1);
        entered();
        await wait;
        await fileStorage.put(k, bytes, mime);
      },
    },
  );
  await started;
  try {
    await expect(upload(t.id, key)).rejects.toMatchObject({
      code: "UPLOAD_BUSY",
    });
  } finally {
    release();
  }
  await uploadPromise;
});
it("denies deactivated accounts even if deactivation occurs during Storage download", async () => {
  const t = await task(),
    file = await upload(t.id);
  try {
    await expect(
      downloadAttachment(owner, file.id, {
        ...fileStorage,
        get: async (key) => {
          const bytes = await fileStorage.get(key);
          await db.person.update({
            where: { id: owner.id },
            data: { status: "INACTIVE" },
          });
          return bytes;
        },
      }),
    ).rejects.toMatchObject({ code: "ACCOUNT_INACTIVE" });
  } finally {
    await db.person.update({
      where: { id: owner.id },
      data: { status: "ACTIVE" },
    });
  }
});
it("rechecks project membership after provider I/O", async () => {
  const t = await task(),
    file = await upload(t.id);
  await submitFiles(t.id, [file.id]);
  await expect(
    downloadAttachment(reviewer, file.id, {
      ...fileStorage,
      get: async (key) => {
        const bytes = await fileStorage.get(key);
        await db.projectMember.delete({
          where: {
            projectId_userId: { projectId: t.projectId, userId: reviewer.id },
          },
        });
        return bytes;
      },
    }),
  ).rejects.toMatchObject({ code: "NOT_FOUND" });
});
it("recovers failed draft deletion while preventing submission of deleting files", async () => {
  const t = await task(),
    file = await upload(t.id);
  fixture.state.failRemove = true;
  try {
    await expect(removeDraftAttachment(owner, file.id)).rejects.toMatchObject({
      code: "STORAGE_UNAVAILABLE",
    });
    await expect(submitFiles(t.id, [file.id])).rejects.toMatchObject({
      code: "INVALID_ATTACHMENTS",
    });
  } finally {
    fixture.state.failRemove = false;
  }
  expect(await removeDraftAttachment(owner, file.id)).toMatchObject({
    status: "DELETED",
  });
  await expect(downloadAttachment(owner, file.id)).rejects.toMatchObject({
    code: "NOT_FOUND",
  });
  expect(
    await db.audit.count({
      where: { entityId: file.id, action: "ATTACHMENT_REMOVED" },
    }),
  ).toBe(1);
});
it("caps outstanding drafts and rejects invalid files before Storage writes", async () => {
  const t = await task();
  const before = fixture.objects.size;
  await expect(
    uploadAttachment(
      owner,
      t.id,
      crypto.randomUUID(),
      "fake.png",
      "image/png",
      content,
    ),
  ).rejects.toMatchObject({ code: "FILE_TYPE" });
  expect(fixture.objects.size).toBe(before);
  for (let i = 0; i < 10; i++) await upload(t.id);
  await expect(upload(t.id)).rejects.toMatchObject({ code: "FILE_LIMIT" });
});
it("exposes authenticated, bounded file HTTP endpoints with safe download headers", async () => {
  const { betterAuth } = await import("better-auth"),
    { prismaAdapter } = await import("better-auth/adapters/prisma");
  const provisioner = betterAuth({
    database: prismaAdapter(db, { provider: "postgresql" }),
    secret: process.env.BETTER_AUTH_SECRET,
    emailAndPassword: { enabled: true },
  });
  const identity = await provisioner.api.signUpEmail({
    body: {
      email: owner.email,
      name: "File owner",
      password: "Synthetic-file-http-9#",
    },
    asResponse: true,
  });
  const user = await db.user.findUniqueOrThrow({
    where: { email: owner.email },
  });
  await db.user.update({
    where: { id: user.id },
    data: { emailVerified: true },
  });
  await db.person.update({
    where: { id: owner.id },
    data: { authUserId: user.id },
  });
  const cookie = identity.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .join("; ");
  const t = await task();
  const { POST } = await import("@/app/api/v1/tasks/[id]/attachments/route");
  const { GET, DELETE } = await import("@/app/api/v1/attachments/[id]/route");
  const origin = process.env.APP_URL ?? process.env.BETTER_AUTH_URL!;
  const headers = {
    cookie,
    Origin: new URL(origin).origin,
    "Content-Type": "text/plain",
    "X-File-Name": "report.txt",
    "X-Encova-CSRF": "1",
    "Idempotency-Key": crypto.randomUUID(),
  };
  const params = { params: Promise.resolve({ id: t.id }) };
  expect(
    (
      await POST(
        new Request(`${origin}/api/v1/tasks/${t.id}/attachments`, {
          method: "POST",
          headers: { ...headers, Origin: "https://foreign.example.test" },
          body: content,
        }),
        params,
      )
    ).status,
  ).toBe(403);
  expect(
    (
      await POST(
        new Request(`${origin}/api/v1/tasks/${t.id}/attachments`, {
          method: "POST",
          headers: { ...headers, "Content-Length": "4194305" },
          body: content,
        }),
        params,
      )
    ).status,
  ).toBe(413);
  const result = await POST(
    new Request(`${origin}/api/v1/tasks/${t.id}/attachments`, {
      method: "POST",
      headers,
      body: content,
    }),
    params,
  );
  expect(result.status).toBe(200);
  const { data } = await result.json();
  const fileParams = { params: Promise.resolve({ id: data.id }) };
  expect(
    (
      await GET(
        new Request(`${origin}/api/v1/attachments/${data.id}`),
        fileParams,
      )
    ).status,
  ).toBe(401);
  const downloaded = await GET(
    new Request(`${origin}/api/v1/attachments/${data.id}`, {
      headers: { cookie },
    }),
    fileParams,
  );
  expect(downloaded.status).toBe(200);
  expect(downloaded.headers.get("cache-control")).toContain("no-store");
  expect(downloaded.headers.get("x-content-type-options")).toBe("nosniff");
  expect(downloaded.headers.get("content-disposition")).toContain(
    "attachment;",
  );
  expect(new Uint8Array(await downloaded.arrayBuffer())).toEqual(content);
  expect(
    (
      await DELETE(
        new Request(`${origin}/api/v1/attachments/${data.id}`, {
          method: "DELETE",
          headers,
        }),
        fileParams,
      )
    ).status,
  ).toBe(200);
});
it("denies activation after deactivation during upload and permits a safe retry afterward", async () => {
  const t = await task(),
    key = crypto.randomUUID();
  try {
    await expect(
      uploadAttachment(owner, t.id, key, "report.txt", "text/plain", content, {
        ...fileStorage,
        put: async (k, bytes, mime) => {
          await fileStorage.put(k, bytes, mime);
          await db.person.update({
            where: { id: owner.id },
            data: { status: "INACTIVE" },
          });
        },
      }),
    ).rejects.toMatchObject({ code: "ACCOUNT_INACTIVE" });
  } finally {
    await db.person.update({
      where: { id: owner.id },
      data: { status: "ACTIVE" },
    });
  }
  expect(
    await db.attachment.count({ where: { taskId: t.id, status: "READY" } }),
  ).toBe(0);
  expect((await upload(t.id, key)).status).toBe("READY");
});
it("rejects a database link to a submission from a different task", async () => {
  const first = await task(),
    second = await task(),
    file = await upload(first.id);
  const other = (await submitFiles(second.id, [])) as { id: string };
  await expect(
    db.attachment.update({
      where: { id: file.id },
      data: { status: "ATTACHED", submissionId: other.id },
    }),
  ).rejects.toThrow();
  expect(
    (await db.attachment.findUniqueOrThrow({ where: { id: file.id } })).status,
  ).toBe("READY");
});
