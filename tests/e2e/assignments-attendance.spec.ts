import { test, expect } from "@playwright/test";
import pg from "pg";
import { login } from "./helpers";
const url =
  process.env.TEST_DATABASE_URL ??
  "postgresql://encova:local_only@localhost:55432/encova_test";
if (new URL(url).pathname !== "/encova_test")
  throw new Error("Dedicated test database required");
test("four overview cards open matching filtered lists and assignments work on mobile", async ({
  page,
}) => {
  await login(page, "e2e.admin@example.test");
  const stats = page.locator(".stats");
  for (const [label, path, filter, value] of [
    ["Active projects", "/projects?status=active", "Project status", "active"],
    ["Open assignments", "/assignments?view=open", "Assignment view", "open"],
    [
      "Awaiting review",
      "/assignments?view=review",
      "Assignment view",
      "review",
    ],
    [
      "Approved work",
      "/assignments?view=approved",
      "Assignment view",
      "approved",
    ],
  ]) {
    await page.goto("/dashboard");
    const card = stats.getByRole("link").filter({ hasText: label });
    await expect(card).toHaveAttribute("href", path);
    const count = Number(await card.locator(".stat-number").innerText());
    await card.click();
    await expect(
      page.getByRole("combobox", { name: filter, exact: true }),
    ).toHaveValue(value);
    await expect(
      page.getByText(
        `${count} ${label === "Active projects" ? "projects" : "assignments"}`,
        { exact: true },
      ),
    ).toBeVisible();
  }
  await page.goto("/assignments");
  await page.getByRole("link", { name: "Assign a task", exact: true }).click();
  await expect(page).toHaveURL(/assignments\/new$/);
  await expect(
    page.getByRole("combobox", { name: "Assignee", exact: true }),
  ).toBeDisabled();
  await expect(page.getByLabel("Independent reviewer")).toBeDisabled();
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto("/assignments?view=open");
  await expect(
    page.getByRole("heading", { name: "Assignments", exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(360);
  await page
    .getByLabel("Search assignments")
    .fill("no-matching-fixture-search");
  await page
    .getByRole("button", { name: "Apply filters", exact: true })
    .click();
  await expect(
    page.getByText("No assignments match these filters."),
  ).toBeVisible();
});
test("root has view-only attendance while HR, team lead and member can punch their own attendance", async ({
  browser,
}) => {
  test.setTimeout(120000);
  const sql = new pg.Client({ connectionString: url });
  await sql.connect();
  const ownerCtx = await browser.newContext(),
    staffCtx = await browser.newContext(),
    owner = await ownerCtx.newPage(),
    staff = await staffCtx.newPage();
  const base = String(test.info().project.use.baseURL),
    ids: string[] = [];
  const post = async (ctx: typeof ownerCtx, path: string, data: unknown) => {
    const r = await ctx.request.post(base + "/api/v1/" + path, {
      headers: {
        Origin: base,
        "X-Encova-CSRF": "1",
        "Idempotency-Key": crypto.randomUUID(),
      },
      data,
    });
    expect(r.status(), await r.text()).toBe(200);
    return (await r.json()).data;
  };
  try {
    await login(owner, "e2e.admin@example.test");
    await owner.goto("/attendance");
    await expect(
      owner.getByRole("region", { name: "My attendance today" }),
    ).toHaveCount(0);
    await expect(
      owner.getByRole("button", { name: /^Check (in|out)$/ }),
    ).toHaveCount(0);
    for (const path of ["check-in", "check-out"]) {
      const r = await owner.request.post(base + "/api/v1/attendance/" + path, {
        headers: {
          Origin: base,
          "X-Encova-CSRF": "1",
          "Idempotency-Key": crypto.randomUUID(),
        },
        data: {},
      });
      expect(r.status()).toBe(403);
      expect((await r.json()).error.code).toBe("ATTENDANCE_VIEW_ONLY");
    }
    const suffix = Date.now().toString(36),
      date = new Intl.DateTimeFormat("en-CA", {
        timeZone: "Asia/Karachi",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(new Date());
    const policy = await post(ownerCtx, "schedules", {
      name: `Role browser ${suffix}`,
      localStart: "00:00",
      localEnd: "23:59",
      weekdays: [0, 1, 2, 3, 4, 5, 6],
      graceMinutes: 0,
      closingBufferMinutes: 0,
    });
    for (const [n, role] of ["HR_ADMIN", "TEAM_LEAD", "MEMBER"].entries()) {
      const email = `punch.${n}.${suffix}@example.test`,
        username = `punch.${n}.${suffix}`;
      const invitation = await post(ownerCtx, "invitations", {
        email,
        username,
        displayName: `Punch ${role} ${suffix}`,
        role,
        employmentType: "EMPLOYEE",
      });
      const mail = await sql.query(
        'SELECT text FROM "Outbox" WHERE "invitationId"=$1 AND "canceledAt" IS NULL',
        [invitation.id],
      );
      const token = mail.rows[0].text.match(/\/invite\/([a-f0-9]{64})/)[1];
      const person = await post(staffCtx, "invitations/accept", {
        token,
        email,
        password: "Synthetic-browser-test-only-9#",
      });
      ids.push(person.id);
      await post(ownerCtx, "schedule-assignments", {
        userId: person.id,
        policyId: policy.id,
        startDate: date,
      });
      await login(staff, email);
      await staff.goto("/attendance");
      const own = staff.getByRole("region", { name: "My attendance today" });
      await own.getByRole("button", { name: "Check in", exact: true }).click();
      await expect(
        own.getByRole("button", { name: "Check out", exact: true }),
      ).toBeVisible();
      await owner.goto("/attendance?q=" + username + "&status=checked-in");
      await expect(
        owner.getByRole("row").filter({ hasText: username }),
      ).toContainText("Checked in");
      await own.getByRole("button", { name: "Check out", exact: true }).click();
      await expect(own.getByText("Your workday is closed.")).toBeVisible();
      await owner.goto("/attendance?q=" + username + "&status=checked-out");
      await expect(
        owner.getByRole("row").filter({ hasText: username }),
      ).toContainText("Checked out");
      if (role === "HR_ADMIN") {
        await expect(
          staff
            .getByRole("navigation", { name: "Main navigation" })
            .getByRole("link"),
        ).toHaveText([
          "Overview",
          "Attendance",
          "Leave approvals",
          "Notifications",
        ]);
      }
      await staff
        .getByRole("button", { name: "Sign out", exact: true })
        .click();
      await expect(staff).toHaveURL(/login$/);
    }
    await owner.goto("/attendance?q=e2e.admin");
    await expect(
      owner.getByRole("row").filter({ hasText: "e2e.admin" }),
    ).toHaveCount(0);
  } finally {
    for (const id of ids) {
      const p = await sql.query('SELECT version FROM "Person" WHERE id=$1', [
        id,
      ]);
      await post(ownerCtx, `users/${id}/deactivate`, {
        expectedVersion: p.rows[0].version,
      });
    }
    await ownerCtx.close();
    await staffCtx.close();
    await sql.end();
  }
});
