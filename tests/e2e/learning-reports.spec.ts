import { test, expect, type BrowserContext } from "@playwright/test";
import pg from "pg";
import { login } from "./helpers";
const url =
  process.env.TEST_DATABASE_URL ??
  "postgresql://encova:local_only@localhost:55432/encova_test";
if (new URL(url).pathname !== "/encova_test")
  throw new Error("Dedicated test database required");
test("complete intern pilot: work approval, milestone, feedback, daily report revisions and independent acknowledgement", async ({
  browser,
}) => {
  test.setTimeout(120000);
  const sql = new pg.Client({ connectionString: url });
  await sql.connect();
  const original = await browser.newContext(),
    adminCtx = await browser.newContext(),
    internCtx = await browser.newContext(),
    originalPage = await original.newPage(),
    admin = await adminCtx.newPage(),
    intern = await internCtx.newPage(),
    ids: string[] = [];
  const base = String(test.info().project.use.baseURL),
    suffix = Date.now().toString(36);
  const post = async (ctx: BrowserContext, path: string, data: unknown) => {
    let response = await ctx.request.post(base + "/api/v1/" + path, {
      headers: {
        Origin: base,
        "X-Encova-CSRF": "1",
        "Idempotency-Key": crypto.randomUUID(),
      },
      data,
    });
    await expect(async () => {
      if (response.status() === 429)
        response = await ctx.request.post(base + "/api/v1/" + path, {
          headers: {
            Origin: base,
            "X-Encova-CSRF": "1",
            "Idempotency-Key": crypto.randomUUID(),
          },
          data,
        });
      expect(response.status(), await response.text()).toBe(200);
    }).toPass({ timeout: 65000, intervals: [1000, 3000, 5000] });
    return (await response.json()).data;
  };
  const provision = async (
    ctx: BrowserContext,
    acceptCtx: BrowserContext,
    name: string,
    role: string,
    employmentType: string,
  ) => {
    const email = `pilot.${name}.${suffix}@example.test`,
      inv = await post(ctx, "invitations", {
        email,
        username: `pilot.${name}.${suffix}`,
        displayName: `Pilot ${name} ${suffix}`,
        role,
        employmentType,
      });
    const queued = await sql.query(
      'SELECT text FROM "Outbox" WHERE "invitationId"=$1 AND "canceledAt" IS NULL',
      [inv.id],
    );
    const token = queued.rows[0].text.match(/\/invite\/([a-f0-9]{64})/)[1];
    const person = await post(acceptCtx, "invitations/accept", {
      email,
      token,
      password: "Synthetic-browser-test-only-9#",
    });
    ids.push(person.id);
    return { ...person, email };
  };
  try {
    await login(originalPage, "e2e.admin@example.test");
    const adminPerson = await provision(
      original,
      adminCtx,
      "admin",
      "SUPER_ADMIN",
      "EMPLOYEE",
    );
    await login(admin, adminPerson.email);
    const student = await provision(
      adminCtx,
      internCtx,
      "intern",
      "MEMBER",
      "INTERN",
    );
    const department = await post(adminCtx, "departments", {
      expectedVersion: 0,
      name: "Pilot department " + suffix,
      archived: false,
    });
    const today = new Intl.DateTimeFormat("en-CA", {
        timeZone: "Asia/Karachi",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(new Date()),
      date = (offset: number) =>
        new Date(Date.parse(today) + offset * 86400000)
          .toISOString()
          .slice(0, 10);
    const enrollmentInput = {
      expectedVersion: 0,
      internId: student.id,
      mentorId: adminPerson.id,
      departmentId: department.id,
      startDate: date(-3),
      endDate: date(30),
      objective: "Learn through independent work review",
      status: "ACTIVE",
    };
    const enrollment = await post(adminCtx, "internships", enrollmentInput);
    const project = await post(adminCtx, "projects", {
      name: "Intern pilot " + suffix,
      description: "Synthetic acceptance journey",
    });
    await post(adminCtx, `projects/${project.id}/members`, {
      userId: student.id,
    });
    const task = await post(adminCtx, "tasks", {
      projectId: project.id,
      assigneeId: student.id,
      reviewerId: adminPerson.id,
      title: "Pilot approved evidence " + suffix,
      description: "Implement and submit evidence",
    });
    await admin.goto("/internships/" + enrollment.id);
    await admin
      .locator("summary")
      .filter({ hasText: /^Add a learning milestone$/ })
      .click();
    const plan = admin.locator("details").filter({
      has: admin
        .locator("summary")
        .filter({ hasText: /^Add a learning milestone$/ }),
    });
    await plan.getByLabel("Milestone title").fill("Ship independent evidence");
    await plan.getByLabel("Milestone due date").fill(date(7));
    await plan
      .getByRole("checkbox", { name: new RegExp("Pilot approved evidence") })
      .check();
    await plan
      .getByRole("button", { name: "Add milestone", exact: true })
      .click();
    const milestone = admin
      .locator("article[data-milestone-id]")
      .filter({ hasText: "Ship independent evidence" });
    await milestone
      .getByRole("button", { name: "Activate milestone", exact: true })
      .click();
    await expect(milestone.locator(".badge")).toHaveText("active");
    await login(intern, student.email);
    await intern.goto("/tasks/" + task.id);
    await intern
      .getByRole("button", { name: "Start task", exact: true })
      .click();
    await intern
      .getByLabel("What did you complete?")
      .fill("Implemented the learning task");
    await intern
      .getByRole("button", { name: "Submit for review", exact: true })
      .click();
    await expect(
      intern.getByText("Your work is waiting for independent review."),
    ).toBeVisible();
    await intern.goto("/internships/" + enrollment.id);
    await intern
      .getByRole("button", { name: "Submit milestone evidence", exact: true })
      .click();
    await expect(
      intern.locator("article[data-milestone-id]").locator(".badge"),
    ).toHaveText("submitted");
    await admin.goto("/tasks/" + task.id);
    await admin
      .getByLabel("Feedback", { exact: true })
      .fill("Verified independently");
    await admin
      .getByRole("button", { name: "Record review", exact: true })
      .click();
    await expect(
      admin.getByText("This assignment is approved.", { exact: false }),
    ).toBeVisible();
    await admin.goto("/internships/" + enrollment.id);
    await admin
      .getByRole("button", { name: "Complete milestone", exact: true })
      .click();
    await expect(
      admin.locator("article[data-milestone-id]").locator(".badge"),
    ).toHaveText("completed");
    await admin
      .locator("summary")
      .filter({ hasText: /^Add weekly feedback$/ })
      .click();
    let monday = new Date(today);
    monday = new Date(
      monday.getTime() - ((monday.getUTCDay() + 6) % 7) * 86400000,
    );
    const feedback = admin.locator("details").filter({
      has: admin
        .locator("summary")
        .filter({ hasText: /^Add weekly feedback$/ }),
    });
    await feedback
      .getByLabel("Week starts (Monday)")
      .fill(monday.toISOString().slice(0, 10));
    await feedback
      .getByLabel("Strengths", { exact: true })
      .fill("Clear independent implementation");
    await feedback.getByLabel("Areas to improve").fill("More boundary cases");
    await feedback.getByLabel("Next actions").fill("Extend tests");
    await feedback
      .getByRole("button", { name: "Add weekly feedback", exact: true })
      .click();
    await expect(
      admin
        .locator("p.preline")
        .filter({ hasText: /^Clear independent implementation$/ }),
    ).toBeVisible();
    await intern.reload();
    await expect(
      intern.getByText("Clear independent implementation", { exact: true }),
    ).toBeVisible();
    await intern.goto("/reports");
    await intern
      .getByRole("checkbox", {
        name: "Pilot approved evidence " + suffix,
        exact: true,
      })
      .check();
    await intern
      .getByLabel("Completed work", { exact: true })
      .fill("Pilot report version one");
    await intern
      .getByRole("button", { name: "Save draft", exact: true })
      .click();
    await intern
      .getByRole("link", {
        name: "Open your report for " + today + " →",
        exact: true,
      })
      .click();
    await expect(
      intern.getByRole("heading", {
        name: "Daily report · " + today,
        exact: true,
      }),
    ).toBeVisible();
    await intern.getByRole("button", { name: "Submit", exact: true }).click();
    await expect(intern.locator(".page-heading .badge")).toHaveText(
      "submitted",
    );
    const reportUrl = intern.url();
    await admin.goto(reportUrl);
    await admin
      .locator("summary")
      .filter({ hasText: /^Return for revision$/ })
      .click();
    await admin
      .getByRole("textbox", { name: "Reason", exact: true })
      .fill("Add next steps");
    await admin
      .getByRole("checkbox", { name: "Confirm return report" })
      .check();
    await admin
      .getByRole("button", { name: "Return report", exact: true })
      .click();
    await expect(admin.locator(".page-heading .badge")).toHaveText("draft");
    await intern.reload();
    await intern.route("**/api/v1/reports/*", async (route) => {
      if (route.request().method() === "PATCH")
        await new Promise((resolve) => setTimeout(resolve, 400));
      await route.continue();
    });
    await intern
      .getByLabel("Completed work", { exact: true })
      .fill("Pilot report version two");
    await intern
      .getByRole("button", { name: "Save draft", exact: true })
      .click();
    await expect(
      intern.getByLabel("Completed work", { exact: true }),
    ).toHaveValue("Pilot report version two");
    await intern.getByRole("button", { name: "Submit", exact: true }).click();
    await expect(intern.locator(".page-heading .badge")).toHaveText(
      "submitted",
    );
    await admin.reload();
    await admin
      .getByRole("button", { name: "Acknowledge", exact: true })
      .click();
    await expect(admin.locator(".page-heading .badge")).toHaveText(
      "acknowledged",
    );
    await expect(
      admin.getByText("Pilot report version one", { exact: true }),
    ).toBeVisible();
    await expect(
      admin.getByText("Pilot report version two", { exact: true }),
    ).toHaveCount(2);
    await post(adminCtx, "internships/" + enrollment.id, {
      ...enrollmentInput,
      expectedVersion: 1,
      status: "COMPLETED",
      reason: "All required evidence independently approved",
    });
    await intern.goto("/internships/" + enrollment.id);
    await expect(intern.locator(".page-heading .badge")).toHaveText(
      "completed",
    );
    await intern.setViewportSize({ width: 360, height: 800 });
    expect(
      await intern.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(360);
  } finally {
    if (ids.length)
      await sql.query(
        'UPDATE "Person" SET status=$1 WHERE id=ANY($2::uuid[])',
        ["INACTIVE", ids],
      );
    await original.close();
    await adminCtx.close();
    await internCtx.close();
    await sql.end();
  }
});
test("Member controls reminder preferences and marks only their own notifications as read", async ({
  page,
}) => {
  test.setTimeout(60000);
  const sql = new pg.Client({ connectionString: url });
  await sql.connect();
  try {
    const users = (
      await sql.query(
        'SELECT id,username FROM "Person" WHERE username=ANY($1)',
        [["e2e.hr", "e2e.member"]],
      )
    ).rows;
    const suffix = Date.now().toString(36);
    for (const p of users)
      await sql.query(
        'INSERT INTO "Notification" (id,"recipientId","eventKey",title,target) VALUES ($1,$2,$3,$4,$5)',
        [
          crypto.randomUUID(),
          p.id,
          "prefs-" + suffix,
          "Preference verification " + suffix,
          "/notifications",
        ],
      );
    await login(page, "e2e.member@example.test");
    await page.goto("/notifications");
    await page
      .locator("summary")
      .filter({ hasText: /^Notification preferences$/ })
      .click();
    const checkbox = page.getByRole("checkbox", {
      name: "Receive in-app missing-report reminders",
    });
    await checkbox.uncheck();
    await page
      .getByRole("button", {
        name: "Save notification preferences",
        exact: true,
      })
      .click();
    await expect(checkbox).not.toBeChecked();
    await page
      .getByRole("button", { name: "Mark all as read", exact: true })
      .click();
    await expect(async () => {
      const r = await sql.query(
        'SELECT "readAt" FROM "Notification" WHERE "recipientId"=$1 AND "eventKey"=$2',
        [users.find((p) => p.username === "e2e.member").id, "prefs-" + suffix],
      );
      expect(r.rows[0].readAt).not.toBeNull();
    }).toPass();
    const other = await sql.query(
      'SELECT "readAt" FROM "Notification" WHERE "recipientId"=$1 AND "eventKey"=$2',
      [users.find((p) => p.username === "e2e.hr").id, "prefs-" + suffix],
    );
    expect(other.rows[0].readAt).toBeNull();
  } finally {
    await sql.end();
  }
});
