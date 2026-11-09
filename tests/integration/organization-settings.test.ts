import "dotenv/config";
import { beforeAll, afterAll, it, expect } from "vitest";
const url =
  process.env.TEST_DATABASE_URL ??
  "postgresql://encova:local_only@localhost:55432/encova_test";
if (new URL(url).pathname !== "/encova_test")
  throw new Error("Dedicated test database required");
process.env.DATABASE_URL = url;
const { db } = await import("@/server/db");
const { mutate } = await import("@/server/transaction");
const {
  saveDepartment,
  saveTeam,
  saveEmployee,
  organizationData,
  employeeDetail,
} = await import("@/modules/organization/service");
const { companySettings, saveSettings } =
  await import("@/modules/settings/service");
const { reportScope } = await import("@/modules/reports/service");
type Actor = Awaited<ReturnType<typeof db.person.create>>;
let root: Actor,
  root2: Actor,
  lead: Actor,
  member: Actor,
  other: Actor,
  dept: string,
  team: string;
const suffix = crypto.randomUUID().slice(0, 8);
const run = (actor: Actor, fn: Parameters<typeof mutate>[4]) =>
  mutate(actor, "org", crypto.randomUUID(), {}, fn);
const profile = {
  expectedVersion: 0,
  departmentId: null as string | null,
  teamId: null as string | null,
  managerId: null as string | null,
  joiningDate: null,
  internshipEndDate: null,
  workMode: "OFFICE" as const,
  privateContact: null as string | null,
};
beforeAll(async () => {
  const people = [];
  for (const [name, role] of [
    ["root", "SUPER_ADMIN"],
    ["root2", "SUPER_ADMIN"],
    ["lead", "TEAM_LEAD"],
    ["member", "MEMBER"],
    ["other", "MEMBER"],
  ] as const)
    people.push(
      await db.person.create({
        data: {
          username: `org.${name}.${suffix}`,
          email: `org.${name}.${suffix}@example.test`,
          displayName: name,
          role,
          status: "ACTIVE",
        },
      }),
    );
  [root, root2, lead, member, other] = people;
  dept = (
    (await run(root, (tx) =>
      saveDepartment(tx, root, {
        expectedVersion: 0,
        name: "Engineering " + suffix,
        archived: false,
      }),
    )) as { id: string }
  ).id;
  team = (
    (await run(root, (tx) =>
      saveTeam(tx, root, {
        expectedVersion: 0,
        name: "Delivery " + suffix,
        departmentId: dept,
        leadId: lead.id,
        archived: false,
      }),
    )) as { id: string }
  ).id;
});
afterAll(async () => {
  await db.person.updateMany({
    where: { id: { in: [root, root2, lead, member, other].map((p) => p.id) } },
    data: { status: "INACTIVE" },
  });
  await db.$disconnect();
});
it("limits organization mutations to root and normalizes department uniqueness", async () => {
  await expect(
    run(lead, (tx) =>
      saveDepartment(tx, lead, {
        expectedVersion: 0,
        name: "Denied",
        archived: false,
      }),
    ),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
  await expect(
    run(root, (tx) =>
      saveDepartment(tx, root, {
        expectedVersion: 0,
        name: "ENGINEERING " + suffix,
        archived: false,
      }),
    ),
  ).rejects.toMatchObject({ code: "DUPLICATE" });
  await expect(organizationData(member)).rejects.toMatchObject({
    code: "FORBIDDEN",
  });
});
it("validates team lead and department membership and versions employee placement", async () => {
  await expect(
    run(root, (tx) =>
      saveTeam(tx, root, {
        expectedVersion: 0,
        name: "Invalid lead",
        departmentId: dept,
        leadId: member.id,
        archived: false,
      }),
    ),
  ).rejects.toMatchObject({ code: "INVALID_LEAD" });
  await expect(
    run(root, (tx) =>
      saveEmployee(tx, root, member.id, { ...profile, teamId: team }),
    ),
  ).rejects.toMatchObject({ code: "INVALID_TEAM" });
  await run(root, (tx) =>
    saveEmployee(tx, root, member.id, {
      ...profile,
      departmentId: dept,
      teamId: team,
      managerId: lead.id,
      privateContact: "Synthetic-private-contact-" + suffix,
    }),
  );
  await expect(
    run(root, (tx) =>
      saveEmployee(tx, root, member.id, { ...profile, departmentId: dept }),
    ),
  ).rejects.toMatchObject({ code: "STALE_VERSION" });
  const dto = await organizationData(root);
  expect(JSON.stringify(dto)).not.toContain("Synthetic-private-contact");
  expect((await employeeDetail(member, member.id))?.privateContact).toContain(
    suffix,
  );
  await expect(employeeDetail(lead, member.id)).rejects.toMatchObject({
    code: "FORBIDDEN",
  });
});
it("rejects direct, indirect and concurrently introduced manager cycles", async () => {
  await expect(
    run(root, (tx) =>
      saveEmployee(tx, root, lead.id, { ...profile, managerId: member.id }),
    ),
  ).rejects.toMatchObject({ code: "MANAGER_CYCLE" });
  await expect(
    run(root, (tx) =>
      saveEmployee(tx, root, other.id, { ...profile, managerId: other.id }),
    ),
  ).rejects.toMatchObject({ code: "MANAGER_CYCLE" });
  const outcomes = await Promise.allSettled([
    run(root, (tx) =>
      saveEmployee(tx, root, other.id, { ...profile, managerId: root2.id }),
    ),
    run(root2, (tx) =>
      saveEmployee(tx, root2, root2.id, { ...profile, managerId: other.id }),
    ),
  ]);
  expect(outcomes.filter((r) => r.status === "fulfilled")).toHaveLength(1);
});
it("blocks archival while profiles use the team or department", async () => {
  await expect(
    run(root, (tx) =>
      saveTeam(
        tx,
        root,
        {
          expectedVersion: 1,
          name: "Delivery " + suffix,
          departmentId: dept,
          leadId: lead.id,
          archived: true,
        },
        team,
      ),
    ),
  ).rejects.toMatchObject({ code: "TEAM_IN_USE" });
  await expect(
    run(root, (tx) =>
      saveDepartment(
        tx,
        root,
        { expectedVersion: 1, name: "Engineering " + suffix, archived: true },
        dept,
      ),
    ),
  ).rejects.toMatchObject({ code: "DEPARTMENT_IN_USE" });
});
it("moves current report access with team leads and never gives demoted members manager access", async () => {
  expect(await reportScope(lead)).toMatchObject({
    userId: { in: expect.arrayContaining([member.id]) },
  });
  await run(root, (tx) =>
    saveTeam(
      tx,
      root,
      {
        expectedVersion: 1,
        name: "Delivery " + suffix,
        departmentId: dept,
        leadId: root2.id,
        archived: false,
      },
      team,
    ),
  );
  expect(await reportScope(lead)).toEqual({ userId: { in: [lead.id] } });
  expect(await reportScope({ ...lead, role: "MEMBER" })).toEqual({
    userId: { in: [lead.id] },
  });
});
it("versions settings, keeps demo policies unconfirmed by default and denies member changes", async () => {
  const old = await companySettings();
  const input = {
    expectedVersion: old.version,
    companyName: old.companyName,
    timezone: "Asia/Karachi" as const,
    workweek: old.workweek as number[],
    reportCutoff: old.reportCutoff,
    reportReminders: old.reportReminders,
    confirmPolicies: false,
  };
  await expect(
    run(member, (tx) => saveSettings(tx, member, input)),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
  const saved = (await run(root, (tx) => saveSettings(tx, root, input))) as {
    version: number;
    policyConfirmedAt: null;
  };
  expect(saved.policyConfirmedAt).toBeNull();
  expect(saved.version).toBe(old.version + 1);
  await expect(
    run(root2, (tx) => saveSettings(tx, root2, input)),
  ).rejects.toMatchObject({ code: "STALE_VERSION" });
});
