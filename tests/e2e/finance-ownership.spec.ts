import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import pg from "pg";
import { mkdir, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { login } from "./helpers";
const url =
  process.env.TEST_DATABASE_URL ??
  "postgresql://encova:local_only@localhost:55432/encova_test";
if (new URL(url).pathname !== "/encova_test")
  throw new Error("Dedicated test database required");
test("owner grants, transfers by acceptance, and revokes access through the real finance screens", async ({
  page,
  browser,
}) => {
  test.setTimeout(150000);
  const sql = new pg.Client({ connectionString: url });
  await sql.connect();
  const base = String(test.info().project.use.baseURL),
    password = "Synthetic-browser-test-only-9#";
  const names = [
    "e2e.finance.owner",
    "e2e.finance.target",
    "e2e.finance.third",
  ];
  const people = (
    await sql.query('SELECT id,username FROM "Person" WHERE username=ANY($1)', [
      names,
    ])
  ).rows as { id: string; username: string }[];
  const owner = people.find((p) => p.username === names[0])!,
    target = people.find((p) => p.username === names[1])!,
    third = people.find((p) => p.username === names[2])!;
  const ids = people.map((p) => p.id);
  const targetContext = await browser.newContext(),
    thirdContext = await browser.newContext();
  const targetPage = await targetContext.newPage(),
    thirdPage = await thirdContext.newPage();
  const cleanup = async () => {
    const current = (await sql.query('SELECT "ownerId" FROM "FinanceSettings"'))
      .rows[0];
    if (current && !ids.includes(current.ownerId))
      throw new Error("Refuse to clear unowned finance owner");
    if (current) await sql.query('TRUNCATE "FinanceSettings"');
    await sql.query(
      'DELETE FROM "FinanceOwnershipTransfer" WHERE "currentOwnerId"=ANY($1)',
      [ids],
    );
    await sql.query('DELETE FROM "FinanceGrant" WHERE "userId"=ANY($1)', [ids]);
  };
  try {
    await cleanup();
    await login(page, owner.username + "@example.test");
    const cookie = (await page.context().cookies())
      .map((c) => `${c.name}=${c.value}`)
      .join("; ");
    await mkdir(".local/finance", { recursive: true });
    const file = resolve(
      `.local/finance/browser-owner-${crypto.randomUUID()}.json`,
    );
    await writeFile(
      file,
      JSON.stringify({
        cookie,
        password,
        reason: "Browser fixture explicit owner",
      }),
      { mode: 0o600 },
    );
    execFileSync(
      process.execPath,
      [
        "--import",
        "tsx",
        "--conditions=react-server",
        "scripts/finance/setup-owner.ts",
      ],
      {
        encoding: "utf8",
        timeout: 20000,
        env: {
          ...process.env,
          DATABASE_URL: url,
          DIRECT_URL: url,
          APP_URL: base,
          BETTER_AUTH_URL: base,
          AUTH_PROVIDER: "better-auth",
          FINANCE_ENABLED: "true",
          FINANCE_OWNER_ID: owner.id,
          FINANCE_OWNER_USERNAME: owner.username,
          FINANCE_OPERATOR_ACK: "BOOTSTRAP_EXPLICIT_OWNER",
          FINANCE_CREDENTIAL_FILE: file,
        },
      },
    );
    await page.goto("/finance/access");
    await expect(
      page.getByRole("heading", { name: `Finance Owner: ${owner.username}` }),
    ).toBeVisible();
    const grant = page.getByRole("region", {
      name: "Grant finance access",
      exact: true,
    });
    await grant.getByLabel("Super Admin").selectOption(target.id);
    await grant
      .getByLabel("Reason", { exact: true })
      .fill("Explore selected administrator access");
    await grant
      .getByLabel("Current password")
      .fill("Wrong-browser-fixture-password");
    await grant
      .getByRole("button", { name: "Grant access", exact: true })
      .click();
    await expect(grant.getByRole("alert")).toContainText(
      "password could not be verified",
    );
    await grant.getByLabel("Current password").fill(password);
    await grant
      .getByRole("button", { name: "Grant access", exact: true })
      .click();
    await expect(
      page
        .getByRole("region", { name: "Selected finance administrators" })
        .getByRole("row")
        .filter({ hasText: target.username }),
    ).toBeVisible();
    await login(targetPage, target.username + "@example.test");
    await targetPage.goto("/finance/access");
    await expect(
      targetPage.getByRole("region", {
        name: "Grant finance access",
        exact: true,
      }),
    ).toHaveCount(0);
    const transfer = page.getByRole("region", {
      name: "Transfer finance ownership",
      exact: true,
    });
    await transfer.getByLabel("New owner").selectOption(target.id);
    await transfer
      .getByLabel("Reason", { exact: true })
      .fill("Hand over finance responsibility");
    await transfer.getByLabel("Current password").fill(password);
    await transfer
      .getByRole("button", { name: "Request ownership transfer" })
      .click();
    await expect(
      page.getByRole("region", { name: "Pending ownership transfer" }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: `Finance Owner: ${owner.username}` }),
    ).toBeVisible();
    await targetPage.reload();
    const accept = targetPage.getByRole("region", {
      name: "Pending ownership transfer",
    });
    await accept
      .getByLabel("Reason", { exact: true })
      .fill("Accept finance ownership");
    await accept.getByLabel("Current password").fill(password);
    await accept.getByRole("button", { name: "Accept ownership" }).click();
    await expect(
      targetPage.getByRole("heading", {
        name: `Finance Owner: ${target.username}`,
      }),
    ).toBeVisible();
    await page.reload();
    await expect(
      page.getByRole("region", { name: "Grant finance access", exact: true }),
    ).toHaveCount(0);
    const former = await page.request.post("/api/v1/finance/access/grants", {
      headers: {
        Origin: base,
        "X-Encova-CSRF": "1",
        "Idempotency-Key": crypto.randomUUID(),
      },
      data: {
        targetId: third.id,
        expectedVersion: 1,
        reason: "Former owner escalation",
        reauth: { password },
      },
    });
    expect(former.status()).toBe(403);
    const targetGrant = targetPage.getByRole("region", {
      name: "Grant finance access",
      exact: true,
    });
    await targetGrant.getByLabel("Super Admin").selectOption(third.id);
    await targetGrant
      .getByLabel("Reason", { exact: true })
      .fill("Grant then revoke a selected user");
    await targetGrant.getByLabel("Current password").fill(password);
    await targetGrant
      .getByRole("button", { name: "Grant access", exact: true })
      .click();
    const row = targetPage
      .getByRole("region", { name: "Selected finance administrators" })
      .getByRole("row")
      .filter({ hasText: third.username });
    await expect(row).toBeVisible();
    await login(thirdPage, third.username + "@example.test");
    expect(
      (await thirdPage.request.get("/api/v1/finance/status")).status(),
    ).toBe(200);
    await row
      .getByRole("button", { name: "Revoke access", exact: true })
      .click();
    const revoke = targetPage.getByRole("region", {
      name: "Revoke selected access",
    });
    await revoke
      .getByLabel("Reason", { exact: true })
      .fill("End temporary finance access");
    await revoke.getByLabel("Current password").fill(password);
    await revoke.getByRole("button", { name: "Confirm revocation" }).click();
    await expect(row).toHaveCount(0);
    expect(
      (await thirdPage.request.get("/api/v1/finance/status")).status(),
    ).toBe(403);
    const targetVersion = (
      await sql.query('SELECT version FROM "Person" WHERE id=$1', [target.id])
    ).rows[0].version;
    const demote = await page.request.post(`/api/v1/users/${target.id}/role`, {
      headers: {
        Origin: base,
        "X-Encova-CSRF": "1",
        "Idempotency-Key": crypto.randomUUID(),
      },
      data: {
        expectedVersion: targetVersion,
        role: "MEMBER",
        reason: "Cannot demote the owner",
      },
    });
    expect(demote.status()).toBe(409);
    expect((await demote.json()).error.code).toBe("FINANCE_OWNER_PROTECTED");
    const noJsContext = await browser.newContext({
      javaScriptEnabled: false,
      storageState: await targetContext.storageState(),
    });
    try {
      const noJs = await noJsContext.newPage();
      await noJs.goto("/finance/access");
      const form = noJs
        .getByRole("region", {
          name: "Grant finance access",
          exact: true,
          includeHidden: true,
        })
        .locator("form");
      await expect(form).toHaveAttribute("method", "post");
      await expect(form.getByLabel("Current password")).toBeDisabled();
    } finally {
      await noJsContext.close();
    }
    await targetPage.setViewportSize({ width: 360, height: 800 });
    const historyTable = targetPage.getByRole("region", {
      name: "Finance history table",
      exact: true,
    });
    await historyTable.focus();
    await expect(historyTable).toBeFocused();
    await targetPage.keyboard.press("ArrowRight");
    await expect
      .poll(() => historyTable.evaluate((element) => element.scrollLeft))
      .toBeGreaterThan(0);
    expect(
      (
        await new AxeBuilder({ page: targetPage })
          .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
          .analyze()
      ).violations,
    ).toEqual([]);
    expect(
      await targetPage.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await expect(
      targetPage.getByRole("region", { name: "Finance access history" }),
    ).toContainText("finance accept");
  } finally {
    await targetContext.close();
    await thirdContext.close();
    await cleanup();
    await sql.end();
  }
});
