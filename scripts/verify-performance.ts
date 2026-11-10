import "dotenv/config";
import fs from "node:fs";
const url =
    process.env.TEST_DATABASE_URL ??
    "postgresql://encova:local_only@localhost:55432/encova_test",
  parsed = new URL(url);
if (
  !["localhost", "127.0.0.1"].includes(parsed.hostname) ||
  parsed.pathname !== "/encova_test"
)
  throw new Error("Performance fixtures require loopback encova_test.");
process.env.DATABASE_URL = url;
const { db } = await import("../src/server/db");
const { tableData } = await import("../src/modules/views/service");
const { tableQuerySchema } = await import("../src/modules/views/queries");
const { reportStatusRows } = await import("../src/modules/reports/status");
const { workDate } = await import("../src/lib/dates");
const suffix = crypto.randomUUID().slice(0, 8),
  ids: string[] = [];
let projectId: string | undefined,
  teamId: string | undefined,
  departmentId: string | undefined;
try {
  const lead = await db.person.create({
    data: {
      username: "perf.lead." + suffix,
      email: "perf.lead." + suffix + "@example.test",
      displayName: "Synthetic performance lead",
      role: "TEAM_LEAD",
      status: "ACTIVE",
    },
  });
  ids.push(lead.id);
  const people = [];
  for (let i = 0; i < 100; i++)
    people.push({
      id: crypto.randomUUID(),
      username: `perf.${i}.${suffix}`,
      email: `perf.${i}.${suffix}@example.test`,
      displayName: `Synthetic person ${i}`,
      role: "MEMBER" as const,
      status: "ACTIVE" as const,
    });
  ids.push(...people.map((p) => p.id));
  await db.person.createMany({ data: people });
  const department = await db.department.create({
    data: {
      name: "Performance " + suffix,
      normalizedName: "performance " + suffix,
    },
  });
  departmentId = department.id;
  const team = await db.team.create({
    data: { name: "Performance " + suffix, departmentId, leadId: lead.id },
  });
  teamId = team.id;
  await db.employeeProfile.createMany({
    data: people.map((p) => ({
      userId: p.id,
      departmentId,
      teamId,
      managerId: lead.id,
      workMode: "OFFICE",
    })),
  });
  const project = await db.project.create({
    data: {
      name: "Performance " + suffix,
      description: "100 synthetic people",
      managerId: lead.id,
    },
  });
  projectId = project.id;
  await db.projectMember.createMany({
    data: ids.map((userId) => ({ projectId: project.id, userId })),
  });
  await db.task.createMany({
    data: people.map((p, i) => ({
      projectId: project.id,
      title: "Performance assignment " + i,
      description: "Synthetic",
      assigneeId: p.id,
      reviewerId: lead.id,
    })),
  });
  const samples: { kind: string; ms: number }[] = [],
    started = performance.now();
  let cursor = 0;
  await Promise.all(
    Array.from({ length: 10 }, async () => {
      for (;;) {
        const n = cursor++;
        if (n >= 100) return;
        const begin = performance.now(),
          kind =
            n % 3 === 0
              ? "task-page"
              : n % 3 === 1
                ? "people-page"
                : "report-status";
        if (kind === "task-page")
          await tableData(
            lead,
            tableQuerySchema.parse({
              entity: "tasks",
              project: project.id,
              page: (n % 4) + 1,
            }),
          );
        else if (kind === "people-page")
          await tableData(
            lead,
            tableQuerySchema.parse({ entity: "people", q: suffix }),
          );
        else await reportStatusRows(lead, workDate());
        samples.push({ kind, ms: performance.now() - begin });
      }
    }),
  );
  const summary = Object.fromEntries(
    ["task-page", "people-page", "report-status"].map((kind) => {
      const ms = samples
        .filter((s) => s.kind === kind)
        .map((s) => s.ms)
        .sort((a, b) => a - b);
      return [
        kind,
        {
          requests: ms.length,
          p50Ms: Math.round(ms[Math.floor(ms.length * 0.5)]),
          p95Ms: Math.round(ms[Math.ceil(ms.length * 0.95) - 1]),
          maxMs: Math.round(ms.at(-1)!),
        },
      ];
    }),
  );
  const evidence = {
    at: new Date().toISOString(),
    environment:
      "isolated local PostgreSQL; domain-service requests, not a hosted capacity/SLA claim",
    syntheticMembers: 100,
    concurrency: 10,
    requests: 100,
    failures: 0,
    elapsedMs: Math.round(performance.now() - started),
    summary,
  };
  fs.mkdirSync(".local/performance", { recursive: true, mode: 0o700 });
  fs.writeFileSync(
    ".local/performance/evidence.json",
    JSON.stringify(evidence, null, 2),
    { mode: 0o600 },
  );
  console.log(JSON.stringify(evidence));
} finally {
  if (projectId) {
    await db.task.updateMany({
      where: { projectId },
      data: { status: "CANCELED" },
    });
    await db.project.update({
      where: { id: projectId },
      data: { archivedAt: new Date() },
    });
  }
  await db.employeeProfile.updateMany({
    where: { userId: { in: ids } },
    data: { teamId: null, managerId: null, departmentId: null },
  });
  if (teamId)
    await db.team.update({
      where: { id: teamId },
      data: { archivedAt: new Date() },
    });
  if (departmentId)
    await db.department.update({
      where: { id: departmentId },
      data: { archivedAt: new Date() },
    });
  await db.person.updateMany({
    where: { id: { in: ids } },
    data: { status: "INACTIVE" },
  });
  await db.$disconnect();
}
