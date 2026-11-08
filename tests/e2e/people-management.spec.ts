import { test, expect } from "@playwright/test";
import pg from "pg";
import { login } from "./helpers";
const url =
  process.env.TEST_DATABASE_URL ??
  "postgresql://encova:local_only@localhost:55432/encova_test";
if (new URL(url).pathname !== "/encova_test")
  throw new Error("Dedicated test database required");
test("Super Admin finds, edits, changes access and restores an account through the management screens", async ({
  page,
  browser,
}) => {
  test.setTimeout(90000);
  const sql = new pg.Client({ connectionString: url });
  await sql.connect();
  const memberCtx = await browser.newContext(),
    hrCtx = await browser.newContext(),
    member = await memberCtx.newPage(),
    hr = await hrCtx.newPage();
  const base = String(test.info().project.use.baseURL);
  const post = async (path: string, data: unknown) => {
    const r = await page.request.post(base + "/api/v1/" + path, {
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
    await login(page, "e2e.admin@example.test");
    const suffix = Date.now().toString(36),
      email = `accounts.browser.${suffix}@example.test`,
      displayName = `Managed browser ${suffix}`;
    const inv = await post("invitations", {
      email,
      username: `managed.${suffix}`,
      displayName,
      role: "MEMBER",
      employmentType: "EMPLOYEE",
    });
    const mail = await sql.query(
      'SELECT text FROM "Outbox" WHERE "invitationId"=$1 AND "canceledAt" IS NULL',
      [inv.id],
    );
    const token = mail.rows[0].text.match(/\/invite\/([a-f0-9]{64})/)[1];
    const accepted = await post("invitations/accept", {
      email,
      token,
      password: "Synthetic-browser-test-only-9#",
    });
    id = accepted.id;
    await login(member, email);
    await page.goto(base + "/people");
    await page.getByLabel("Search people").fill(email);
    await page
      .getByRole("button", { name: "Apply filters", exact: true })
      .click();
    const directory = page.getByRole("region", {
      name: "Manage accounts",
      exact: true,
    });
    const row = directory.getByRole("row").filter({ hasText: email });
    await expect(row).toBeVisible();
    await row.getByRole("link", { name: "Manage", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: displayName, exact: true }),
    ).toBeVisible();
    const name = `Updated managed ${suffix}`;
    await page.getByLabel("Display name", { exact: true }).fill(name);
    await page.getByLabel("Username", { exact: true }).fill(`edited.${suffix}`);
    await page
      .getByLabel("Employment type", { exact: true })
      .selectOption("INTERN");
    await page
      .getByRole("button", { name: "Save profile", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name, exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText("profile updated", { exact: true }),
    ).toBeVisible();
    await expect(page.getByText(email, { exact: false })).toBeVisible();
    const rolePanel = page.locator("section.panel").filter({
      has: page.getByRole("heading", { name: "Change role", exact: true }),
    });
    await rolePanel.getByLabel("Account role").selectOption("TEAM_LEAD");
    await rolePanel
      .getByLabel("Reason for role change")
      .fill("Browser role management verification");
    await rolePanel.getByRole("checkbox").check();
    await rolePanel
      .getByRole("button", { name: "Save role", exact: true })
      .click();
    await expect(page.getByText("role changed", { exact: true })).toBeVisible();
    expect((await member.request.get(base + "/api/v1/me")).status()).toBe(401);
    await login(member, email);
    expect(
      (await (await member.request.get(base + "/api/v1/me")).json()).data.role,
    ).toBe("TEAM_LEAD");
    const statusPanel = page.locator("section.panel").filter({
      has: page.getByRole("heading", {
        name: "Deactivate account",
        exact: true,
      }),
    });
    await statusPanel
      .getByLabel("Reason for deactivation")
      .fill("Browser access suspension verification");
    await statusPanel.getByRole("checkbox").check();
    await statusPanel
      .getByRole("button", { name: "Deactivate account", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Reactivate account", exact: true }),
    ).toBeVisible();
    expect((await member.request.get(base + "/api/v1/me")).status()).toBe(401);
    await page
      .getByRole("link", { name: "Back to people", exact: false })
      .click();
    await page.getByLabel("Search people").fill(email);
    await page.getByLabel("Account status").selectOption("INACTIVE");
    await page
      .getByRole("button", { name: "Apply filters", exact: true })
      .click();
    await directory
      .getByRole("row")
      .filter({ hasText: email })
      .getByRole("link", { name: "Manage", exact: true })
      .click();
    const restore = page.locator("section.panel").filter({
      has: page.getByRole("heading", { name: "Restore access", exact: true }),
    });
    await restore
      .getByLabel("Reason for reactivation")
      .fill("Browser access restoration verification");
    await restore.getByRole("checkbox").check();
    await restore
      .getByRole("button", { name: "Reactivate account", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Deactivate account", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText("person reactivated", { exact: true }),
    ).toBeVisible();
    await login(member, email);
    expect(
      (await (await member.request.get(base + "/api/v1/me")).json()).data.role,
    ).toBe("TEAM_LEAD");
    await page.setViewportSize({ width: 360, height: 800 });
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= 360),
    ).toBe(true);
    await login(hr, "e2e.hr@example.test");
    await hr.goto(base + "/people/" + id);
    await expect(
      hr.getByRole("heading", { name: "Page not found.", exact: true }),
    ).toBeVisible();
    const me = (await (await page.request.get(base + "/api/v1/me")).json())
      .data;
    await page.goto(base + "/people/" + me.id);
    await expect(
      page.getByRole("heading", {
        name: "Your account is protected",
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Save role", exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Deactivate account", exact: true }),
    ).toHaveCount(0);
  } finally {
    if (id) {
      const current = await sql.query(
        'SELECT version,status FROM "Person" WHERE id=$1',
        [id],
      );
      if (current.rows[0]?.status === "ACTIVE")
        await post(`users/${id}/deactivate`, {
          expectedVersion: current.rows[0].version,
        });
    }
    await memberCtx.close();
    await hrCtx.close();
    await sql.end();
  }
});
