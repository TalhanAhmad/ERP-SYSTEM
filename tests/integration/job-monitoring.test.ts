import "dotenv/config";
import { beforeAll, afterAll, it, expect } from "vitest";
const url =
  process.env.TEST_DATABASE_URL ??
  "postgresql://encova:local_only@localhost:55432/encova_test";
if (new URL(url).pathname !== "/encova_test")
  throw new Error("Dedicated test database required");
process.env.DATABASE_URL = url;
const { db } = await import("@/server/db");
const {
  createAttendanceJob,
  runAttendanceJob,
  claimAttendanceJob,
  processAttendanceClaim,
  operationsSnapshot,
  ensureScheduledAttendance,
} = await import("@/server/jobs/monitoring");
type Actor = Awaited<ReturnType<typeof db.person.create>>;
let admin: Actor, member: Actor, hr: Actor;
let counter = 0;
const suffix = crypto.randomUUID().slice(0, 8);
beforeAll(async () => {
  // Prior runs leave immutable history in this dedicated synthetic database.
  // Retire only this suite's old audience fixtures before capturing a new one.
  await db.person.updateMany({
    where: { username: { startsWith: "job.p." } },
    data: { status: "INACTIVE" },
  });
  [admin, member, hr] = await Promise.all(
    (
      [
        ["admin", "SUPER_ADMIN"],
        ["member", "MEMBER"],
        ["hr", "HR_ADMIN"],
      ] as const
    ).map(([name, role]) =>
      db.person.create({
        data: {
          username: `job.${name}.${suffix}`,
          email: `job.${name}.${suffix}@example.test`,
          displayName: name,
          role,
          status: "ACTIVE",
        },
      }),
    ),
  );
});
afterAll(async () => {
  await db.$disconnect();
});
async function fixture(count = 3) {
  const date = new Date(Date.UTC(2026, 8, ++counter))
      .toISOString()
      .slice(0, 10),
    prefix = `job.p.${suffix}.${counter}`;
  const policy = await db.schedulePolicy.create({
    data: {
      name: "Synthetic job policy",
      localStart: "09:00",
      localEnd: "17:00",
      weekdays: [0, 1, 2, 3, 4, 5, 6],
      graceMinutes: 0,
      closingBufferMinutes: 0,
    },
  });
  const people = Array.from({ length: count }, (_, n) => ({
    id: crypto.randomUUID(),
    username: `${prefix}.${n}`,
    email: `${prefix}.${n}@example.test`,
    displayName: "Job fixture",
    status: "ACTIVE" as const,
  }));
  await db.person.createMany({ data: people });
  await db.scheduleAssignment.createMany({
    data: people.map((p) => ({
      userId: p.id,
      policyId: policy.id,
      startDate: new Date(date),
      endDate: new Date(date),
    })),
  });
  const job = await db.$transaction((tx) =>
    createAttendanceJob(tx, admin, {
      workDate: date,
      reason: "Synthetic monitored attendance",
    }),
  );
  return { job, people, date };
}
const run = (
  id: string,
  version: number,
  key = crypto.randomUUID(),
  options: Parameters<typeof runAttendanceJob>[5] = {},
) =>
  runAttendanceJob(
    id,
    key,
    admin,
    { expectedVersion: version, reason: "Synthetic audited run" },
    "ADMIN",
    options,
  );
it("processes a captured 100-person audience without clock slicing or missing people", async () => {
  const { job, people, date } = await fixture(100);
  const result = await run(job.id, 1);
  expect(result).toMatchObject({
    status: "SUCCEEDED",
    processed: 100,
    total: 100,
    updatedCount: 100,
    attemptCount: 1,
  });
  expect(
    await db.attendanceDay.count({
      where: {
        userId: { in: people.map((p) => p.id) },
        workDate: new Date(date),
        status: "ABSENT",
      },
    }),
  ).toBe(100);
  expect(
    await db.audit.count({
      where: {
        action: "ATTENDANCE_RECONCILED",
        changes: { path: ["runId"], equals: job.id },
      },
    }),
  ).toBe(100);
}, 30000);
it("resumes partial work from the saved cursor and replays a lost request without a second attempt", async () => {
  const { job } = await fixture(),
    key = crypto.randomUUID();
  const first = await run(job.id, 1, key, { maxItems: 1 });
  expect(first).toMatchObject({
    status: "QUEUED",
    processed: 1,
    updatedCount: 1,
    attemptCount: 1,
  });
  expect(await run(job.id, 1, key)).toEqual(first);
  const finished = await run(job.id, first.version);
  expect(finished).toMatchObject({
    status: "SUCCEEDED",
    processed: 3,
    updatedCount: 3,
    attemptCount: 2,
  });
  const attempts = await db.jobAttempt.findMany({
    where: { runId: job.id },
    orderBy: { startedAt: "asc" },
  });
  expect(attempts.map((a) => a.status)).toEqual(["PARTIAL", "SUCCEEDED"]);
});
it("rolls back a failed item and records only a safe failure code before audited retry", async () => {
  const { job, date, people } = await fixture();
  let calls = 0;
  await expect(
    run(job.id, 1, crypto.randomUUID(), {
      processPerson: async (tx, userId, ...rest) => {
        calls++;
        if (calls === 2) {
          await tx.attendanceDay.create({
            data: {
              userId,
              workDate: new Date(date),
              snapshot: {},
              status: "ABSENT",
            },
          });
          throw new Error("private-password-never-persist");
        }
        const { reconcilePersonAttendance } =
          await import("@/server/jobs/attendance");
        return reconcilePersonAttendance(tx, userId, ...rest);
      },
    }),
  ).rejects.toMatchObject({ code: "JOB_FAILED" });
  const failed = await db.jobRun.findUniqueOrThrow({ where: { id: job.id } });
  expect(failed).toMatchObject({
    status: "FAILED",
    cursor: 1,
    errorCode: "ATTENDANCE_JOB_FAILED",
  });
  expect(
    await db.attendanceDay.count({
      where: {
        userId: { in: people.map((p) => p.id) },
        workDate: new Date(date),
      },
    }),
  ).toBe(1);
  const snapshot = await operationsSnapshot(admin);
  expect(JSON.stringify(snapshot)).not.toContain(
    "private-password-never-persist",
  );
  expect(snapshot.jobs.find((j) => j.id === job.id)).not.toHaveProperty(
    "audience",
  );
  const result = await run(job.id, failed.version);
  expect(result).toMatchObject({
    status: "SUCCEEDED",
    processed: 3,
    updatedCount: 3,
  });
  expect(
    await db.audit.count({
      where: { entityId: job.id, action: "JOB_ATTEMPT_REQUESTED" },
    }),
  ).toBe(2);
});
it("rejects competing active claims and preserves a single worker", async () => {
  const { job } = await fixture();
  const first = await claimAttendanceJob(
    job.id,
    crypto.randomUUID(),
    admin,
    { expectedVersion: 1, reason: "Claim fixture" },
    "ADMIN",
  );
  await expect(run(job.id, 2)).rejects.toMatchObject({ code: "JOB_BUSY" });
  expect(await db.jobAttempt.count({ where: { runId: job.id } })).toBe(1);
  expect((await processAttendanceClaim(job.id, first.attemptId)).status).toBe(
    "SUCCEEDED",
  );
});
it("recovers an interrupted lease, retains abandoned history and rejects a stale worker", async () => {
  const { job } = await fixture();
  const claim = await claimAttendanceJob(
    job.id,
    crypto.randomUUID(),
    admin,
    { expectedVersion: 1, reason: "Interrupted fixture" },
    "ADMIN",
  );
  await db.jobRun.update({
    where: { id: job.id },
    data: { leaseUntil: new Date(0) },
  });
  expect((await processAttendanceClaim(job.id, claim.attemptId)).status).toBe(
    "INTERRUPTED",
  );
  const result = await run(job.id, 2);
  expect(result).toMatchObject({ status: "SUCCEEDED", attemptCount: 2 });
  expect(
    (await db.jobAttempt.findUniqueOrThrow({ where: { id: claim.attemptId } }))
      .status,
  ).toBe("ABANDONED");
  const attempts = result.attemptCount;
  expect(
    (await processAttendanceClaim(job.id, claim.attemptId)).attemptCount,
  ).toBe(attempts);
});
it("rejects stale versions, future dates and non-admin access without creating attempts", async () => {
  const { job } = await fixture();
  for (const actor of [member, hr]) {
    await expect(operationsSnapshot(actor)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await expect(
      runAttendanceJob(job.id, crypto.randomUUID(), actor, {
        expectedVersion: 1,
        reason: "Forbidden request",
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  }
  await expect(run(job.id, 99)).rejects.toMatchObject({
    code: "STALE_VERSION",
  });
  expect(await db.jobAttempt.count({ where: { runId: job.id } })).toBe(0);
  await expect(
    db.$transaction((tx) =>
      createAttendanceJob(tx, admin, {
        workDate: "2099-01-01",
        reason: "Future fixture",
      }),
    ),
  ).rejects.toMatchObject({ code: "FUTURE_JOB" });
});
it("never mutates corrected attendance or raw check history, and skips deactivated snapshot members", async () => {
  const { job, people, date } = await fixture();
  const corrected = await db.attendanceDay.create({
    data: {
      userId: people[0].id,
      workDate: new Date(date),
      snapshot: {
        kind: "WORKDAY",
        start: date + "T09:00:00+05:00",
        end: date + "T17:00:00+05:00",
        policyId: crypto.randomUUID(),
        graceMinutes: 0,
        closingBufferMinutes: 0,
      },
      status: "PRESENT",
      corrected: true,
      firstIn: new Date(date + "T04:00:00Z"),
      lastOut: new Date(date + "T12:00:00Z"),
      grossMinutes: 480,
    },
  });
  await db.attendanceEvent.create({
    data: {
      dayId: corrected.id,
      userId: people[0].id,
      kind: "IN",
      occurredAt: new Date(date + "T04:00:00Z"),
    },
  });
  await db.person.update({
    where: { id: people[1].id },
    data: { status: "INACTIVE" },
  });
  const result = await run(job.id, 1);
  expect(result).toMatchObject({ processed: 3, updatedCount: 1 });
  expect(
    await db.attendanceDay.findUniqueOrThrow({ where: { id: corrected.id } }),
  ).toEqual(corrected);
  expect(
    await db.attendanceEvent.count({ where: { dayId: corrected.id } }),
  ).toBe(1);
});
it("makes scheduled-date creation idempotent and keeps completed scope/history immutable", async () => {
  const date = "2026-08-25";
  const [a, b] = await Promise.all([
    ensureScheduledAttendance(date),
    ensureScheduledAttendance(date),
  ]);
  expect(a.id).toBe(b.id);
  const { job } = await fixture(0);
  const result = await runAttendanceJob(
    job.id,
    crypto.randomUUID(),
    null,
    { reason: "Service fixture" },
    "CLI",
  );
  expect(result.status).toBe("SUCCEEDED");
  await expect(
    db.jobRun.update({ where: { id: job.id }, data: { cursor: 0 } }),
  ).rejects.toThrow();
  await expect(
    db.jobAttempt.update({
      where: { id: result.attempts[0].id },
      data: { reason: "Rewrite history" },
    }),
  ).rejects.toThrow();
  await expect(db.jobRun.delete({ where: { id: job.id } })).rejects.toThrow();
});
it("protects run and monitoring HTTP routes with session/origin checks and idempotent retry", async () => {
  const { betterAuth } = await import("better-auth"),
    { prismaAdapter } = await import("better-auth/adapters/prisma");
  const auth = betterAuth({
    database: prismaAdapter(db, { provider: "postgresql" }),
    secret: process.env.BETTER_AUTH_SECRET,
    emailAndPassword: { enabled: true },
  });
  const identity = await auth.api.signUpEmail({
    body: {
      email: admin.email,
      name: admin.displayName,
      password: "Synthetic-job-http-fixture-9#",
    },
    asResponse: true,
  });
  const user = await db.user.findUniqueOrThrow({
    where: { email: admin.email },
  });
  await db.user.update({
    where: { id: user.id },
    data: { emailVerified: true },
  });
  await db.person.update({
    where: { id: admin.id },
    data: { authUserId: user.id },
  });
  const cookie = identity.headers
      .getSetCookie()
      .map((c) => c.split(";")[0])
      .join("; "),
    origin = process.env.APP_URL ?? process.env.BETTER_AUTH_URL!;
  const { GET } = await import("@/app/api/v1/[...path]/route");
  const { POST } =
    await import("@/app/api/v1/operations/attendance-jobs/[id]/run/route");
  const { job } = await fixture(1);
  const params = { params: Promise.resolve({ id: job.id }) };
  const headers = {
    cookie,
    Origin: new URL(origin).origin,
    "Content-Type": "application/json",
    "X-Encova-CSRF": "1",
    "Idempotency-Key": crypto.randomUUID(),
  };
  expect(
    (
      await GET(new Request(origin + "/api/v1/operations"), {
        params: Promise.resolve({ path: ["operations"] }),
      })
    ).status,
  ).toBe(401);
  const payload = { expectedVersion: 1, reason: "HTTP fixture" };
  expect(
    (
      await POST(
        new Request(
          origin + "/api/v1/operations/attendance-jobs/" + job.id + "/run",
          {
            method: "POST",
            headers: { ...headers, Origin: "https://foreign.example.test" },
            body: JSON.stringify(payload),
          },
        ),
        params,
      )
    ).status,
  ).toBe(403);
  const invoke = () =>
    POST(
      new Request(
        origin + "/api/v1/operations/attendance-jobs/" + job.id + "/run",
        { method: "POST", headers, body: JSON.stringify(payload) },
      ),
      params,
    );
  expect((await invoke()).status).toBe(200);
  expect((await invoke()).status).toBe(200);
  expect(await db.jobAttempt.count({ where: { runId: job.id } })).toBe(1);
  const snapshot = await GET(
    new Request(origin + "/api/v1/operations", { headers: { cookie } }),
    { params: Promise.resolve({ path: ["operations"] }) },
  );
  expect(snapshot.status).toBe(200);
  expect(snapshot.headers.get("cache-control")).toContain("no-store");
  const json = JSON.stringify(await snapshot.json());
  expect(json).not.toContain("requestKey");
  expect(json).not.toContain("activeAttemptId");
  expect(json).not.toContain("audience");
});
it("stops a manual attempt when its operator loses access before processing", async () => {
  const { job } = await fixture(1);
  const claim = await claimAttendanceJob(
    job.id,
    crypto.randomUUID(),
    admin,
    { expectedVersion: 1, reason: "Revoked operator fixture" },
    "ADMIN",
  );
  try {
    await db.person.update({
      where: { id: admin.id },
      data: { status: "INACTIVE" },
    });
    const result = await processAttendanceClaim(job.id, claim.attemptId);
    expect(result).toMatchObject({
      status: "FAILED",
      processed: 0,
      errorCode: "OPERATOR_REVOKED",
    });
  } finally {
    await db.person.update({
      where: { id: admin.id },
      data: { status: "ACTIVE" },
    });
  }
});
