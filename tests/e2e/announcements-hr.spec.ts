import { test, expect } from "@playwright/test";
import pg from "pg";
import { login } from "./helpers";
const url =
  process.env.TEST_DATABASE_URL ??
  "postgresql://encova:local_only@localhost:55432/encova_test";
if (new URL(url).pathname !== "/encova_test")
  throw new Error("Dedicated test database required");
test("HR sees named check-in status, approves leave and has only the focused menus", async ({
  page,
  browser,
}) => {
  test.setTimeout(90000);
  const sql = new pg.Client({ connectionString: url });
  await sql.connect();
  const ownerCtx = await browser.newContext(),
    memberCtx = await browser.newContext(),
    owner = await ownerCtx.newPage(),
    member = await memberCtx.newPage();
  const base = String(test.info().project.use.baseURL);
  const post = async (ctx: typeof ownerCtx, path: string, data: unknown) => {
    const r = await ctx.request.post(base + "/api/v1/" + path, {
      headers: {
        Origin: base,
        "X-Encova-CSRF": "1",
        "Idempotency-Key": crypto.randomUUID(),
      },
      data,
    });
    expect(r.status()).toBe(200);
    return (await r.json()).data;
  };
  let id: string | undefined;
  try {
    await login(owner, "e2e.admin@example.test");
    const suffix = Date.now().toString(36),
      email = `hr.browser.${suffix}@example.test`,
      name = `HR attendance fixture ${suffix}`;
    const invitation = await post(ownerCtx, "invitations", {
      email,
      username: `hr.browser.${suffix}`,
      displayName: name,
      role: "MEMBER",
      employmentType: "EMPLOYEE",
    });
    const mail = await sql.query(
      'SELECT text FROM "Outbox" WHERE "invitationId"=$1 AND "canceledAt" IS NULL',
      [invitation.id],
    );
    const token = mail.rows[0].text.match(/\/invite\/([a-f0-9]{64})/)[1];
    const person = await post(memberCtx, "invitations/accept", {
      token,
      email,
      password: "Synthetic-browser-test-only-9#",
    });
    id = person.id;
    const date = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Karachi",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date());
    const policy = await post(ownerCtx, "schedules", {
      name: `HR browser ${suffix}`,
      localStart: "00:00",
      localEnd: "23:59",
      weekdays: [0, 1, 2, 3, 4, 5, 6],
      graceMinutes: 0,
      closingBufferMinutes: 0,
    });
    await post(ownerCtx, "schedule-assignments", {
      userId: id,
      policyId: policy.id,
      startDate: date,
    });
    await login(page, "e2e.hr@example.test");
    await expect(
      page.getByRole("heading", { name: "HR overview", exact: true }),
    ).toBeVisible();
    const nav = page.getByRole("navigation", { name: "Main navigation" });
    await expect(nav.getByRole("link")).toHaveText([
      "Overview",
      "Attendance",
      "Leave approvals",
      "Notifications",
    ]);
    await nav.getByRole("link", { name: "Attendance", exact: true }).click();
    const row = page.getByRole("row").filter({ hasText: name });
    await expect(
      row.getByText("Not checked in", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Check in", exact: true }),
    ).toHaveCount(0);
    await login(member, email);
    await member.goto(base + "/attendance");
    await member.getByRole("button", { name: "Check in", exact: true }).click();
    await expect(
      member.getByRole("button", { name: "Check out", exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Refresh attendance" }).click();
    await expect(row.getByText("Checked in", { exact: true })).toBeVisible();
    await member
      .getByRole("button", { name: "Check out", exact: true })
      .click();
    await expect(member.getByText("Your workday is closed.")).toBeVisible();
    await page.getByRole("button", { name: "Refresh attendance" }).click();
    await expect(row.getByText("Checked out", { exact: true })).toBeVisible();
    // Select a scheduled day rather than depending on the wall-clock date or
    // the fixed synthetic holiday used by the integration suite.
    let tomorrow = "";
    for (let offset = 1; offset <= 7; offset++) {
      const candidate = new Intl.DateTimeFormat("en-CA", {
        timeZone: "Asia/Karachi",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(new Date(Date.now() + offset * 86400000));
      const holiday = await sql.query(
        'SELECT 1 FROM "Holiday" WHERE date=$1::date',
        [candidate],
      );
      if (!holiday.rowCount) {
        tomorrow = candidate;
        break;
      }
    }
    expect(tomorrow).not.toBe("");
    const note = `HR browser leave ${suffix}`;
    await post(memberCtx, "leave", {
      startDate: tomorrow,
      endDate: tomorrow,
      type: "PERSONAL",
      privateNote: note,
    });
    await nav.getByRole("link", { name: "Leave approvals" }).click();
    await expect(page.getByText("Request leave", { exact: true })).toHaveCount(
      0,
    );
    const card = page.locator("section.panel").filter({ hasText: note });
    await expect(card).toContainText(name);
    await card.getByRole("button", { name: "Approve", exact: true }).click();
    await expect(card.locator(".badge")).toHaveText("approved");
    const denied = await page.request.get(base + "/api/v1/invitations");
    expect(denied.status()).toBe(403);
    await page.goto(base + "/people");
    await expect(
      page.getByRole("heading", { name: "Page not found.", exact: true }),
    ).toBeVisible();
  } finally {
    if (id) {
      const p = await sql.query('SELECT version FROM "Person" WHERE id=$1', [
        id,
      ]);
      await post(ownerCtx, `users/${id}/deactivate`, {
        expectedVersion: p.rows[0].version,
      });
    }
    await ownerCtx.close();
    await memberCtx.close();
    await sql.end();
  }
});
test("one admin announcement reaches all roles, supports editing/deletion and expires on an open page", async ({
  page,
  browser,
}) => {
  test.setTimeout(90000);
  const sql = new pg.Client({ connectionString: url });
  await sql.connect();
  const hrCtx = await browser.newContext(),
    memberCtx = await browser.newContext();
  const hr = await hrCtx.newPage(),
    member = await memberCtx.newPage();
  const base = String(test.info().project.use.baseURL);
  try {
    await login(page, "e2e.admin@example.test");
    await page.goto(base + "/announcements");
    await login(hr, "e2e.hr@example.test");
    await login(member, "e2e.member@example.test");
    await page
      .getByLabel("Title", { exact: true })
      .fill("Shared office update");
    await page
      .getByLabel("Message", { exact: true })
      .fill("Everyone sees the same admin message.");
    await page
      .getByRole("button", { name: "Publish announcement", exact: true })
      .click();
    await expect(
      page.getByRole("region", { name: "Company announcement" }),
    ).toContainText("Shared office update");
    await expect(
      hr.getByRole("region", { name: "Company announcement" }),
    ).toContainText("Shared office update", { timeout: 25000 });
    await expect(
      member.getByRole("region", { name: "Company announcement" }),
    ).toContainText("Shared office update", { timeout: 25000 });
    await expect(page.getByLabel("Message", { exact: true })).toBeVisible({
      timeout: 5000,
    });
    await page
      .getByLabel("Message", { exact: true })
      .fill("Edited update for everyone.");
    await page
      .getByRole("button", { name: "Save announcement", exact: true })
      .click();
    await expect(
      page.getByRole("region", { name: "Company announcement" }),
    ).toContainText("Edited update");
    await hr.evaluate(() =>
      document.dispatchEvent(new Event("visibilitychange")),
    );
    await expect(
      hr.getByRole("region", { name: "Company announcement" }),
    ).toContainText("Edited update");
    await hr.goto(base + "/notifications");
    await expect(
      hr.getByRole("region", { name: "Company announcement" }),
    ).toContainText("Edited update");
    expect(
      (
        await hr.request.post(base + "/api/v1/announcements", {
          headers: {
            Origin: base,
            "X-Encova-CSRF": "1",
            "Idempotency-Key": crypto.randomUUID(),
          },
          data: { title: "Unauthorized", body: "Denied" },
        })
      ).status(),
    ).toBe(403);
    await page
      .getByRole("button", { name: "Delete announcement", exact: true })
      .click();
    await expect(
      page.getByRole("region", { name: "Company announcement" }),
    ).toHaveCount(0);
    await member.evaluate(() =>
      document.dispatchEvent(new Event("visibilitychange")),
    );
    await expect(
      member.getByRole("region", { name: "Company announcement" }),
    ).toHaveCount(0);
    await page
      .getByLabel("Title", { exact: true })
      .fill("Expires automatically");
    await page
      .getByLabel("Message", { exact: true })
      .fill("This test message has a controlled short expiry.");
    await page
      .getByRole("button", { name: "Publish announcement", exact: true })
      .click();
    await expect(
      page.getByRole("region", { name: "Company announcement" }),
    ).toContainText("Expires automatically");
    await sql.query(
      "UPDATE \"Announcement\" SET \"publishedAt\"=now()-interval '1 hour',\"expiresAt\"=now()+interval '5 seconds' WHERE slot='workspace'",
    );
    await member.reload();
    await expect(
      member.getByRole("region", { name: "Company announcement" }),
    ).toContainText("Expires automatically");
    await expect(
      member.getByRole("region", { name: "Company announcement" }),
    ).toHaveCount(0, { timeout: 8000 });
    const expired = await member.request.get(base + "/api/v1/announcements");
    expect((await expired.json()).data).toBeNull();
    expect(
      Number(
        (await sql.query('SELECT count(*) FROM "Announcement"')).rows[0].count,
      ),
    ).toBe(0);
  } finally {
    await sql.query('DELETE FROM "Announcement"');
    await sql.end();
    await hrCtx.close();
    await memberCtx.close();
  }
});
