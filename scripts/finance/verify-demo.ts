import assert from "node:assert/strict";
import { readFile, writeFile, mkdir, realpath, stat } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import pg from "pg";
import { chromium, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { demoManifestSchema, demoEnvironment, demoPaths } from "./demo-config";
const root = await realpath(process.cwd()),
  file = path.join(root, ".local/finance-demo/manifest.json");
assert.equal(
  (await stat(file)).mode & 0o077,
  0,
  "Private demo manifest required",
);
const m = demoManifestSchema.parse(JSON.parse(await readFile(file, "utf8")));
assert.equal(m.projectRoot, root);
const paths = demoPaths(m),
  base = `http://localhost:${m.appPort}`,
  output = path.join(root, ".local/finance-demo/evidence");
await mkdir(output, { recursive: true, mode: 0o700 });
const sql = new pg.Client({
  connectionString: demoEnvironment(m, true).DATABASE_URL,
});
await sql.connect();
assert.equal(
  await realpath(
    (await sql.query("SHOW data_directory")).rows[0].data_directory,
  ),
  await realpath(paths.database),
);
const fixture = JSON.parse(await readFile(paths.fixture, "utf8")),
  scenarios: string[] = [];
const browser = await chromium.launch({ headless: true });
try {
  const before = (
    await sql.query('SELECT count(*)::int AS n FROM "FinanceJournalEntry"')
  ).rows[0].n;
  assert.equal(before, 9);
  let exportId = "";
  for (let n = 0; n < m.accounts.length; n++) {
    const a = m.accounts[n],
      context = await browser.newContext({ baseURL: base });
    try {
      await context.addCookies([
        {
          name: "better-auth.session_token",
          value: "synthetic-unrelated-workspace-cookie",
          domain: "localhost",
          path: "/",
          httpOnly: true,
          sameSite: "Lax",
        },
      ]);
      const page = await context.newPage();
      await page.goto("/login");
      await expect(
        page.getByRole("complementary", { name: "Finance demo notice" }),
      ).toBeVisible();
      await page.getByLabel("Work email").fill(a.email);
      await page.getByLabel("Password", { exact: true }).fill(a.password);
      await page.getByRole("button", { name: "Sign in to workspace" }).click();
      await expect(page).toHaveURL(/dashboard/);
      const cookies = await context.cookies();
      assert.equal(
        cookies.find((c) => c.name === "better-auth.session_token")?.value,
        "synthetic-unrelated-workspace-cookie",
      );
      assert.ok(
        cookies.some((c) => c.name === "encova-finance-demo.session_token"),
      );
      const status = await page.request.get("/api/v1/finance/status");
      assert.equal(status.status(), n < 2 ? 200 : 403);
      if (n < 2) {
        await page.goto(
          "/finance/reports/profit-loss?from=2020-01-01&to=2020-01-31",
        );
        await expect(page.getByText(/180,?000\.00/).first()).toBeVisible();
        const pl = (
          await (
            await page.request.get(
              "/api/v1/finance/reports/profit-loss?from=2020-01-01&to=2020-01-31",
            )
          ).json()
        ).data;
        assert.equal(pl.sections.netProfit, "180000.00");
        const bs = (
          await (
            await page.request.get(
              "/api/v1/finance/reports/balance-sheet?asOf=2020-01-31",
            )
          ).json()
        ).data;
        assert.equal(bs.sections.totalAssets, "785000.00");
        assert.equal(bs.sections.difference, "0.00");
        const bank = (
          await (
            await page.request.get(
              `/api/v1/finance/reports/general-ledger?from=2020-01-01&to=2020-01-31&accountId=${fixture.fixture.accounts.bank}`,
            )
          ).json()
        ).data;
        assert.equal(bank.closingBalance, "575000.00");
        const trial = (
          await (
            await page.request.get(
              "/api/v1/finance/reports/trial-balance?from=2020-01-01&to=2020-01-31",
            )
          ).json()
        ).data;
        assert.equal(trial.companyTotals.periodDebit, "1445000.00");
        assert.equal(trial.companyTotals.periodCredit, "1445000.00");
        await expect(
          page.getByRole("link", {
            name: "Demo January 2020 profit and loss",
            exact: true,
          }),
        ).toBeVisible();
        if (n === 0) {
          const mutation = async (url: string, body: object) =>
            page.request.post(url, {
              headers: {
                origin: base,
                "x-encova-csrf": "1",
                "Idempotency-Key": crypto.randomUUID(),
              },
              data: { ...body, reauth: { password: a.password } },
            });
          const created = await mutation("/api/v1/finance/journals", {
            reference: "DEMO-VERIFY-" + crypto.randomUUID().slice(0, 8),
            description: "Synthetic demo write verification",
            evidence: "Isolated demo only; never posted",
            postingDate: "2020-01-20",
            lines: [
              {
                accountId: fixture.fixture.accounts.expense,
                description: "Synthetic debit",
                debit: "0.01",
                credit: "0.00",
              },
              {
                accountId: fixture.fixture.accounts.revenue,
                description: "Synthetic credit",
                debit: "0.00",
                credit: "0.01",
              },
            ],
            reason: "Verify normal draft creation without altering demo books",
          });
          assert.equal(created.status(), 201);
          const draft = (await created.json()).data,
            voided = await mutation(
              `/api/v1/finance/journals/${draft.id}/void`,
              {
                expectedVersion: draft.version,
                reason:
                  "Retain the verified unposted synthetic draft as voided",
              },
            );
          assert.equal(voided.status(), 200);
          await page.goto(
            "/finance/exports/new?reportType=PROFIT_LOSS&from=2020-01-01&to=2020-01-31",
          );
          await page
            .getByLabel("Reason", { exact: true })
            .fill("Review exact synthetic finance demo statements");
          await page
            .getByLabel("Current password", { exact: true })
            .fill(a.password);
          const responsePromise = page.waitForResponse(
            (r) =>
              r.url().startsWith(base + "/api/v1/finance/exports") &&
              r.request().method() === "POST",
          );
          await page
            .getByRole("button", {
              name: "Prepare private export",
              exact: true,
            })
            .click();
          const response = await responsePromise,
            result = await response.json();
          assert.equal(
            response.status(),
            202,
            "Export request failed: " +
              (result.error?.code ?? "unexpected status"),
          );
          exportId = result.data.id;
          await expect(page).toHaveURL(
            new RegExp("/finance/exports/" + exportId + "$"),
            { timeout: 15000 },
          );
          await expect(
            page.getByRole("heading", { name: "REVIEW · ready", exact: true }),
          ).toBeVisible({ timeout: 15000 });
          const detail = (
            await (
              await page.request.get(`/api/v1/finance/exports/${exportId}`)
            ).json()
          ).data;
          for (const kind of ["csv", "pdf"]) {
            const response = await page.request.get(
              `/api/v1/finance/exports/${exportId}/${kind}`,
            );
            assert.equal(response.status(), 200);
            assert.match(response.headers()["cache-control"], /no-store/);
            const bytes = await response.body();
            assert.equal(
              createHash("sha256").update(bytes).digest("hex"),
              detail[kind + "Hash"],
            );
            if (kind === "pdf")
              assert.equal(bytes.subarray(0, 5).toString(), "%PDF-");
          }
          await page.goto(
            "/finance/reports/profit-loss?from=2020-01-01&to=2020-01-31",
          );
          await page.setViewportSize({ width: 390, height: 844 });
          assert.equal(
            await page.evaluate(
              () => document.documentElement.scrollWidth <= innerWidth,
            ),
            true,
          );
          assert.deepEqual(
            (
              await new AxeBuilder({ page })
                .withTags(["wcag2a", "wcag2aa"])
                .analyze()
            ).violations,
            [],
          );
          await page
            .getByRole("link", {
              name: "Demo January 2020 trial balance",
              exact: true,
            })
            .focus();
          await expect(
            page.getByRole("link", {
              name: "Demo January 2020 trial balance",
              exact: true,
            }),
          ).toBeFocused();
          await page
            .getByRole("heading", { name: "Profit and loss", exact: true })
            .evaluate((heading) => heading.scrollIntoView({ block: "start" }));
          await page.screenshot({
            path: path.join(output, "finance-demo-mobile.png"),
            fullPage: false,
          });
          scenarios.push(
            "Owner: isolated cookies, exact actual statements, normal draft/void, private CSV/PDF hashes, mobile/WCAG/keyboard",
          );
        } else
          scenarios.push(
            "Selected administrator: actual private financial statements",
          );
      } else {
        await expect(
          page
            .getByRole("navigation", { name: "Main navigation" })
            .getByRole("link", { name: "Finance", exact: true }),
        ).toHaveCount(0);
        await page.goto("/finance");
        await expect(
          page.getByRole("heading", { name: /not found|couldn.t find/i }),
        ).toBeVisible();
        assert.equal(
          (
            await page.request.get(`/api/v1/finance/exports/${exportId}/pdf`)
          ).status(),
          403,
        );
        scenarios.push(
          a.name + ": financial navigation, pages and artifact access denied",
        );
      }
    } finally {
      await context.close();
    }
  }
  const runtime = new pg.Client({
    connectionString: demoEnvironment(m).DATABASE_URL,
  });
  await runtime.connect();
  try {
    const privileges = (
      await runtime.query(
        "SELECT current_user,has_table_privilege(current_user,'\"FinanceJournalLine\"','INSERT,UPDATE,DELETE') AS write,has_function_privilege(current_user,'encova_finance_bill_core(uuid,text,jsonb,text,uuid)','EXECUTE') AS raw",
      )
    ).rows[0];
    assert.deepEqual(privileges, {
      current_user: "encova_app",
      write: false,
      raw: false,
    });
  } finally {
    await runtime.end();
  }
  assert.equal(
    (await sql.query('SELECT count(*)::int AS n FROM "FinanceJournalEntry"'))
      .rows[0].n,
    before,
  );
  scenarios.push(
    "Restricted runtime SQL grants; nine posted sources unchanged",
  );
  await writeFile(
    path.join(output, "verification.json"),
    JSON.stringify(
      {
        kind: "ISOLATED_SYNTHETIC_DEMO",
        at: new Date().toISOString(),
        url: base,
        scenarios,
        postedSources: before,
        bank: "575000.00",
        profit: "180000.00",
        assets: "785000.00",
        productionTouched: false,
      },
      null,
      2,
    ),
    { mode: 0o600 },
  );
  console.log(
    `PASS: ${scenarios.length} actual isolated-demo browser/security scenarios;9 posted sources unchanged.`,
  );
} catch (error) {
  await writeFile(
    path.join(output, "verification-error.log"),
    error instanceof Error ? (error.stack ?? error.message) : String(error),
    { mode: 0o600 },
  );
  console.error("Demo verification failed; inspect the private evidence log.");
  process.exitCode = 1;
} finally {
  await browser.close();
  await sql.end();
}
