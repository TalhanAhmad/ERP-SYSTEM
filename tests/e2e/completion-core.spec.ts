import { test, expect } from "@playwright/test";
import pg from "pg";
import { login } from "./helpers";
const url =
  process.env.TEST_DATABASE_URL ??
  "postgresql://encova:local_only@localhost:55432/encova_test";
if (new URL(url).pathname !== "/encova_test")
  throw new Error("Dedicated test database required");
const post = async (
  page: import("@playwright/test").Page,
  path: string,
  data: unknown,
) => {
  const base = new URL(page.url()).origin;
  const r = await page.request.post("/api/v1/" + path, {
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
test("calendar forms assign and replace a future shift and manage holidays", async ({
  page,
}) => {
  await login(page, "e2e.admin@example.test");
  const sql = new pg.Client({ connectionString: url });
  await sql.connect();
  try {
    const member = (
      await sql.query('SELECT id FROM "Person" WHERE email=$1', [
        "e2e.member@example.test",
      ])
    ).rows[0];
    const suffix = Date.now().toString(36),
      date = new Date(
        Date.now() + (1000 + Math.floor(Math.random() * 5000)) * 86400000,
      )
        .toISOString()
        .slice(0, 10);
    const policies = [];
    for (const name of ["First", "Second"])
      policies.push(
        await post(page, "schedules", {
          name: `${name} calendar ${suffix}`,
          localStart: "09:00",
          localEnd: "17:00",
          weekdays: [1, 2, 3, 4, 5],
          graceMinutes: 0,
          closingBufferMinutes: 0,
        }),
      );
    const assignmentData = await post(page, "schedule-assignments", {
      userId: member.id,
      policyId: policies[0].id,
      startDate: date,
      endDate: date,
    });
    await page.goto("/schedules");
    const assignment = page.locator(
      `[data-assignment-id="${assignmentData.id}"]`,
    );
    await assignment.locator("summary").click();
    await assignment
      .getByRole("combobox", { name: "New schedule", exact: true })
      .selectOption(policies[1].id);
    await assignment.getByLabel("Replace from").fill(date);
    await assignment
      .getByLabel("Reason for schedule change")
      .fill("Browser replacement");
    await assignment
      .getByRole("button", { name: "Replace schedule", exact: true })
      .click();
    await expect(assignment.locator(":scope > p")).toContainText(
      `Second calendar ${suffix}`,
    );
    const holidays = page.locator("section.panel").filter({
      has: page.getByRole("heading", { name: "Holidays", exact: true }),
    });
    const holidayDate = new Date(Date.parse(date) + 86400000)
      .toISOString()
      .slice(0, 10);
    await holidays
      .locator(":scope > form")
      .getByLabel("Holiday name", { exact: true })
      .fill("Browser holiday " + suffix);
    await holidays
      .locator(":scope > form")
      .getByLabel("Holiday date", { exact: true })
      .fill(holidayDate);
    await holidays
      .getByRole("button", { name: "Add holiday", exact: true })
      .click();
    const holiday = holidays
      .locator("article")
      .filter({ hasText: "Browser holiday " + suffix });
    await holiday.locator("summary").click();
    await holiday.getByRole("checkbox").check();
    await holiday
      .getByRole("button", { name: "Remove holiday", exact: true })
      .click();
    await expect(holiday).toHaveCount(0);
  } finally {
    await sql.end();
  }
});
test("root manages project/task lifecycle through forms while preserving history", async ({
  page,
}) => {
  await login(page, "e2e.admin@example.test");
  const sql = new pg.Client({ connectionString: url });
  await sql.connect();
  try {
    const users = (
      await sql.query(
        'SELECT id,username FROM "Person" WHERE username=ANY($1)',
        [["e2e.member", "e2e.reviewer"]],
      )
    ).rows;
    const project = await post(page, "projects", {
      name: "Lifecycle browser " + Date.now(),
      description: "Synthetic",
    });
    for (const u of users)
      await post(page, `projects/${project.id}/members`, { userId: u.id });
    const task = await post(page, "tasks", {
      projectId: project.id,
      assigneeId: users.find((u) => u.username === "e2e.member").id,
      reviewerId: users.find((u) => u.username === "e2e.reviewer").id,
      title: "Lifecycle browser task",
      description: "Synthetic",
    });
    await page.goto("/tasks/" + task.id);
    await page
      .locator("summary")
      .filter({ hasText: /^Edit task$/ })
      .click();
    await page
      .getByLabel("Task title", { exact: true })
      .fill("Edited lifecycle browser task");
    await page.getByRole("button", { name: "Save task", exact: true }).click();
    await expect(
      page.getByRole("heading", {
        name: "Edited lifecycle browser task",
        exact: true,
      }),
    ).toBeVisible();
    await page
      .getByLabel("Comment", { exact: true })
      .fill("Retained browser discussion");
    await page
      .getByRole("button", { name: "Post comment", exact: true })
      .click();
    await expect(
      page.getByText("Retained browser discussion", { exact: true }),
    ).toBeVisible();
    await page
      .locator("summary")
      .filter({ hasText: /^Cancel task$/ })
      .click();
    await page
      .getByRole("textbox", { name: "Reason", exact: true })
      .fill("Scope changed");
    await page.getByRole("checkbox", { name: "Confirm cancel task" }).check();
    await page
      .getByRole("button", { name: "Cancel task", exact: true })
      .click();
    await page
      .locator("summary")
      .filter({ hasText: /^Reopen task$/ })
      .click();
    await page
      .getByRole("textbox", { name: "Reason", exact: true })
      .fill("Resume fixture");
    await page.getByRole("checkbox", { name: "Confirm reopen task" }).check();
    await page
      .getByRole("button", { name: "Reopen task", exact: true })
      .click();
    await expect(
      page.getByText("Retained browser discussion", { exact: true }),
    ).toBeVisible();
    await page.goto("/projects/" + project.id);
    await page
      .locator("summary")
      .filter({ hasText: /^Archive project$/ })
      .click();
    await page
      .getByRole("textbox", { name: "Reason", exact: true })
      .fill("Archive fixture");
    await page
      .getByRole("checkbox", { name: "Cancel all unfinished tasks" })
      .check();
    await page
      .getByRole("checkbox", { name: "Confirm archive project" })
      .check();
    await page
      .getByRole("button", { name: "Archive project", exact: true })
      .click();
    await page
      .locator("summary")
      .filter({ hasText: /^Restore project$/ })
      .click();
    await page
      .getByRole("textbox", { name: "Reason", exact: true })
      .fill("Restore fixture");
    await page
      .getByRole("checkbox", { name: "Confirm restore project" })
      .check();
    await page
      .getByRole("button", { name: "Restore project", exact: true })
      .click();
    await expect(
      page.locator("summary").filter({ hasText: /^Archive project$/ }),
    ).toBeVisible();
  } finally {
    await sql.end();
  }
});
test("root creates a department/team and saves a private employment profile", async ({
  page,
}) => {
  await login(page, "e2e.admin@example.test");
  const suffix = Date.now().toString(36);
  await page.goto("/organization");
  const departments = page.locator("section.panel").filter({
    has: page.getByRole("heading", { name: "Departments", exact: true }),
  });
  await departments
    .locator("summary")
    .filter({ hasText: /^Create department$/ })
    .click();
  await departments
    .getByRole("textbox", { name: "Department name", exact: true })
    .fill("Browser department " + suffix);
  await departments
    .getByRole("button", { name: "Create department", exact: true })
    .click();
  await expect(
    departments.getByRole("heading", {
      name: "Browser department " + suffix,
      exact: true,
    }),
  ).toBeVisible();
  const teams = page
    .locator("section.panel")
    .filter({ has: page.getByRole("heading", { name: "Teams", exact: true }) });
  await teams
    .locator("summary")
    .filter({ hasText: /^Create team$/ })
    .click();
  await teams
    .getByRole("textbox", { name: "Team name", exact: true })
    .fill("Browser team " + suffix);
  await teams
    .getByRole("combobox", { name: "Department", exact: true })
    .selectOption({ label: "Browser department " + suffix });
  await teams
    .getByRole("combobox", { name: "Team lead", exact: true })
    .selectOption({ label: "e2e.admin (@e2e.admin)" });
  await teams.getByRole("button", { name: "Create team", exact: true }).click();
  await expect(
    teams.getByRole("heading", { name: "Browser team " + suffix, exact: true }),
  ).toBeVisible();
  await page
    .getByRole("link", { name: "e2e.member · @e2e.member", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Employment profile", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("combobox", { name: "Department", exact: true })
    .selectOption({ label: "Browser department " + suffix });
  await page
    .getByRole("combobox", { name: "Primary team", exact: true })
    .selectOption({ label: "Browser team " + suffix });
  await page
    .getByRole("combobox", { name: "Work mode", exact: true })
    .selectOption("REMOTE");
  await page
    .getByLabel("Private contact (optional)")
    .fill("Synthetic private contact " + suffix);
  await page
    .getByRole("button", { name: "Save employment profile", exact: true })
    .click();
  await expect(
    page.getByText("Saved successfully.", { exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(page.getByLabel("Private contact (optional)")).toHaveValue(
    "Synthetic private contact " + suffix,
  );
  await page.setViewportSize({ width: 360, height: 800 });
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(360);
});
