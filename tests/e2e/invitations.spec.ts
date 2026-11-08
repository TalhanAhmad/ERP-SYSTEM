import { test, expect } from "@playwright/test";
import pg from "pg";
import { login } from "./helpers";
const url =
  process.env.TEST_DATABASE_URL ??
  "postgresql://encova:local_only@localhost:55432/encova_test";
if (new URL(url).pathname !== "/encova_test")
  throw new Error("Browser token fixture queries require encova_test");
test("administrator resends/revokes invitations and only a replacement link creates an account", async ({
  page,
  browser,
}) => {
  test.setTimeout(90000);
  const sql = new pg.Client({ connectionString: url });
  await sql.connect();
  const guestContext = await browser.newContext();
  const guest = await guestContext.newPage();
  const base = String(test.info().project.use.baseURL);
  try {
    await login(page, "e2e.admin@example.test");
    await page.goto("/people");
    async function invite(label: string) {
      const suffix = Date.now().toString(36) + label;
      const email = `browser.inv.${suffix}@example.test`;
      const form = page
        .locator("section.panel")
        .filter({ has: page.getByText("Invite a person", { exact: true }) });
      await form.locator("details").evaluate((node) => {
        (node as HTMLDetailsElement).open = true;
      });
      await form.getByLabel("Display name").fill(`Browser ${label}`);
      await form.getByLabel("Username").fill(`browser.${suffix}`);
      await form.getByLabel("Email", { exact: true }).fill(email);
      await form
        .getByRole("button", { name: "Send invitation", exact: true })
        .click();
      const row = page.getByRole("row").filter({ hasText: email });
      await expect(row).toBeVisible();
      const result = await sql.query(
        'SELECT id FROM "Invitation" WHERE email=$1',
        [email],
      );
      return { email, id: result.rows[0].id, row };
    }
    async function token(id: string) {
      const r = await sql.query(
        'SELECT text FROM "Outbox" WHERE "invitationId"=$1 AND "canceledAt" IS NULL ORDER BY "createdAt" DESC LIMIT 1',
        [id],
      );
      return r.rows[0].text.match(/\/invite\/([a-f0-9]{64})/)[1] as string;
    }
    async function accept(email: string, token: string) {
      await guest.goto(base + `/invite/${token}`);
      await guest.getByLabel("Invited email").fill(email);
      await guest.getByLabel("Choose a password").fill("Demo9x2!");
      await guest
        .getByRole("button", { name: "Accept invitation", exact: true })
        .click();
    }
    const item = await invite("replacement");
    const old = await token(item.id);
    await item.row
      .getByRole("button", { name: "Resend invitation", exact: true })
      .click();
    await expect(
      item.row.getByText(
        "New invitation queued. The previous link is invalid.",
      ),
    ).toBeVisible();
    const replacement = await token(item.id);
    expect(replacement).not.toBe(old);
    await accept(item.email, old);
    await expect(guest.locator("form").getByRole("alert")).toContainText(
      "Invitation is invalid",
    );
    await accept(item.email, replacement);
    await expect(guest.getByText("Account created.")).toBeVisible();
    await guest.goto(base + "/login");
    await guest.getByLabel("Work email").fill(item.email);
    await guest.getByLabel("Password", { exact: true }).fill("Demo9x2!");
    await guest.getByRole("button", { name: "Sign in to workspace" }).click();
    await guest.waitForURL("**/dashboard");
    await guest.getByRole("button", { name: "Sign out", exact: true }).click();
    await guest.waitForURL("**/login");
    await page.reload();
    await expect(item.row.getByText("accepted", { exact: true })).toBeVisible();
    await expect(
      item.row.getByRole("button", { name: "Resend invitation" }),
    ).toHaveCount(0);
    const revoked = await invite("revoked"),
      revokedToken = await token(revoked.id);
    await revoked.row
      .getByRole("button", { name: "Revoke invitation", exact: true })
      .click();
    await expect(
      revoked.row.getByText("revoked", { exact: true }),
    ).toBeVisible();
    await accept(revoked.email, revokedToken);
    await expect(guest.locator("form").getByRole("alert")).toContainText(
      "Invitation is invalid",
    );
  } finally {
    await guestContext.close();
    await sql.end();
  }
});
