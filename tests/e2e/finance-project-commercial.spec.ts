import { test, expect, type Locator } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { financeFixture } from "./finance-fixture";
import { login } from "./helpers";
test("private project contract, approved variation, milestone and retained invoice links never post commercial plans or expose them to managers", async ({
  page,
  browser,
}) => {
  test.setTimeout(150000);
  const f = await financeFixture(
      page,
      String(test.info().project.use.baseURL),
      "e2e.finance.commercial",
    ),
    p = "PC27." + crypto.randomUUID().slice(0, 6).toUpperCase(),
    reader = await browser.newContext(),
    manager = await browser.newContext();
  let writerId: string | undefined;
  const authorize = async (form: Locator, label: string) => {
    await form
      .getByLabel("Reason", { exact: true })
      .fill("Explicit synthetic commercial review");
    await form.getByLabel("Current password", { exact: true }).fill(f.password);
    await form.getByRole("button", { name: label, exact: true }).click();
  };
  try {
    const session = (
      await f.sql.query(
        'SELECT id FROM "session" WHERE "userId"=$1 ORDER BY "createdAt" DESC LIMIT 1',
        [f.owner.authUserId],
      )
    ).rows[0];
    const seed = async (
      fn: string,
      action: string,
      input: Record<string, unknown>,
    ) =>
      (
        await f.sql.query(
          `SELECT ${fn}($1,'better-auth',$2,CURRENT_TIMESTAMP,$3,$4::jsonb,$5,$6) AS result`,
          [
            f.owner.id,
            session.id,
            action,
            JSON.stringify(input),
            crypto.randomUUID(),
            crypto.randomUUID(),
          ],
        )
      ).rows[0].result;
    const lead = (
      await f.sql.query('SELECT id FROM "Person" WHERE username=$1', [
        "e2e.finance.commercial.manager",
      ])
    ).rows[0];
    writerId = (
      await f.sql.query('SELECT id FROM "Person" WHERE username=$1', [
        "e2e.finance.commercial.writer",
      ])
    ).rows[0].id;
    await f.sql.query(
      'INSERT INTO "FinanceGrant"(id,"userId","grantedById",reason) VALUES(gen_random_uuid(),$1,$2,$3)',
      [writerId, f.owner.id, "Explicit isolated commercial writer"],
    );
    const projectId = crypto.randomUUID(),
      name = p + " project";
    await f.sql.query(
      'INSERT INTO "Project"(id,name,description,"managerId","updatedAt") VALUES($1,$2,$3,$4,CURRENT_TIMESTAMP)',
      [projectId, name, "Ordinary delivery workspace", lead.id],
    );
    await f.sql.query(
      'INSERT INTO "ProjectMember"("projectId","userId") VALUES($1,$2)',
      [projectId, lead.id],
    );
    const slot = (
      await f.sql.query(
        `SELECT d::date::text AS start FROM generate_series(DATE '1900-01-01',DATE '1950-01-01',interval '10 days')d WHERE NOT EXISTS(SELECT 1 FROM "FinancePeriod" f WHERE f.state<>'VOID' AND daterange(f."startDate",f."endDate",'[]') && daterange(d::date,(d+interval '9 days')::date,'[]')) ORDER BY d LIMIT 1`,
      )
    ).rows[0];
    if (!slot) throw new Error("No isolated commercial test interval");
    const period = {
      start: String(slot.start),
      end: new Date(
        new Date(String(slot.start) + "T00:00:00Z").getTime() + 9 * 86400000,
      )
        .toISOString()
        .slice(0, 10),
    };
    await seed("encova_finance_setup_command", "PERIOD_CREATE", {
      name: p,
      startDate: period.start,
      endDate: period.end,
      reason: "Explicit isolated commercial browser period",
    });
    const ar = await f.seedAccount(p + ".AR", { controlType: "RECEIVABLES" }),
      revenue = await f.seedAccount(p + ".REV", {
        type: "INCOME",
        normalSide: "CREDIT",
        reportGroup: "REVENUE",
      }),
      client = await seed("encova_finance_master_command", "PARTY_CREATE", {
        name: p + " client",
        legalName: p + " client",
        kind: "CLIENT",
        contactEmail: null,
        phone: null,
        address: null,
        userId: null,
        reason: "Synthetic commercial customer",
      });
    const invoice = await seed("encova_finance_invoice_command", "CREATE", {
      reference: p,
      partyId: client.id,
      receivableAccountId: ar.id,
      projectId,
      invoiceDate: period.start,
      postingDate: period.start,
      dueDate: period.end,
      description: "Reviewed delivery invoice",
      evidence: "Explicit delivery evidence",
      currency: "PKR",
      lines: [
        {
          description: "Earned delivery",
          quantity: "1",
          unitRate: "10.01",
          discountAmount: "0.00",
          taxCodeId: null,
          recognition: "EARNED",
          revenueAccountId: revenue.id,
          deferredAccountId: null,
          projectId,
        },
      ],
      reason: "Recognize delivery separately from plan",
    });
    await seed("encova_finance_invoice_command", "POST", {
      id: invoice.id,
      expectedVersion: 1,
      reason: "Post delivery explicitly",
    });
    const line = (
        await f.sql.query(
          'SELECT l.id,i.number FROM "FinanceInvoiceLine" l JOIN "FinanceInvoice" i ON i.id=l."invoiceId" WHERE i.id=$1',
          [invoice.id],
        )
      ).rows[0],
      before = (
        await f.sql.query(
          'SELECT count(*)::int AS n FROM "FinanceJournalEntry"',
        )
      ).rows[0].n;
    await page.goto("/projects/" + projectId);
    await page
      .getByRole("link", { name: "Project finance", exact: true })
      .click();
    await expect(
      page.getByRole("heading", {
        name: name + " · Commercial profile",
        exact: true,
      }),
    ).toBeVisible();
    await page.getByLabel("Search contract client", { exact: true }).fill(p);
    await page
      .getByLabel("Contract client", { exact: true })
      .selectOption(client.id);
    await page.getByLabel("Original contract value (PKR)").fill("100.01");
    await page.getByLabel("Commercial terms").fill("SENSITIVE-COMMERCIAL-" + p);
    await page
      .getByLabel("Contract evidence reference")
      .fill("Signed synthetic agreement");
    await authorize(page.locator("form"), "Create commercial profile");
    await expect(
      page.getByRole("region", { name: "Commercial agreement", exact: true }),
    ).toContainText("100.01");
    const activate = page.getByRole("region", {
      name: "ACTIVATE commercial profile",
      exact: true,
    });
    await activate.getByLabel("Agreement signed date").fill(period.start);
    await activate
      .getByLabel("Contract approval evidence")
      .fill("Explicit signed contract review");
    await activate.getByRole("checkbox").check();
    await authorize(activate.locator("form"), "Confirm signed contract");
    await expect(
      page.getByText("ACTIVE · version 2", { exact: false }),
    ).toBeVisible();
    await page
      .getByRole("link", { name: "Create variation draft", exact: true })
      .click();
    await page.getByLabel("Variation value (PKR)").fill("20.02");
    await page.getByLabel("Signed amendment reference").fill(p + "-VAR");
    await page
      .getByLabel("Variation description")
      .fill("Signed scope increase");
    await page.getByLabel("Amendment signed date").fill(period.start);
    await page.getByLabel("Amendment evidence").fill("Signed scope amendment");
    await authorize(page.locator("form"), "Create variation draft");
    await expect(page).toHaveURL(
      /\/finance\/project-variations\/[a-f0-9-]{36}$/,
    );
    const approve = page.getByRole("region", {
      name: "APPROVE commercial source",
      exact: true,
    });
    await approve
      .getByLabel("Approval evidence")
      .fill("Reviewed signed scope increase");
    await approve.getByRole("checkbox").check();
    await authorize(approve.locator("form"), "Approve signed variation");
    await expect(
      page.getByText("APPROVED · version 2", { exact: true }),
    ).toBeVisible();
    await page.goto("/finance/projects/" + projectId);
    await expect(
      page.getByRole("region", { name: "Commercial agreement", exact: true }),
    ).toContainText("120.03");
    await page
      .getByRole("link", {
        name: "Create billing milestone draft",
        exact: true,
      })
      .click();
    await page
      .getByLabel("Billing milestone description")
      .fill("Reviewed delivery payment stage");
    await page.getByLabel("Planned milestone value (PKR)").fill("50.00");
    await page
      .getByLabel("Expected billing date", { exact: true })
      .fill(period.start);
    await page.getByLabel("Expected payment due date").fill(period.end);
    await page
      .getByLabel("Billing plan evidence")
      .fill("Signed milestone payment plan");
    await authorize(page.locator("form"), "Create billing milestone draft");
    await expect(page).toHaveURL(
      /\/finance\/billing-milestones\/[a-f0-9-]{36}$/,
    );
    const milestoneUrl = page.url(),
      confirm = page.getByRole("region", {
        name: "CONFIRM commercial source",
        exact: true,
      });
    await confirm
      .getByLabel("Approval evidence")
      .fill("Explicit milestone review");
    await confirm.getByRole("checkbox").check();
    await authorize(confirm.locator("form"), "Confirm billing milestone");
    await expect(
      page.getByText("CONFIRMED · version 2", { exact: true }),
    ).toBeVisible();
    const w = await reader.newPage();
    await login(w, "e2e.finance.commercial.writer@example.test");
    await w.goto(milestoneUrl);
    const link = w.getByRole("region", {
      name: "Link reviewed invoice",
      exact: true,
    });
    await link
      .getByLabel("Search posted invoice line for this project", {
        exact: true,
      })
      .fill(line.number);
    await link
      .getByLabel("Posted invoice line for this project", { exact: true })
      .selectOption(line.id);
    await authorize(link.locator("form"), "Link posted invoice line");
    await w
      .getByRole("link", { name: line.number + " · line 1", exact: true })
      .click();
    await expect(
      w.getByRole("heading", {
        name: "Milestone invoice relationship",
        exact: true,
      }),
    ).toBeVisible();
    const linkId = w.url().split("/").pop();
    const release = w.getByRole("region", {
      name: "Release invoice relationship",
      exact: true,
    });
    await release.getByRole("checkbox").check();
    await authorize(release.locator("form"), "Release invoice relationship");
    await expect(
      w.getByText("RELEASED · version 2", { exact: true }),
    ).toBeVisible();
    expect(
      (
        await f.sql.query(
          'SELECT count(*)::int AS n FROM "FinanceJournalEntry"',
        )
      ).rows[0].n,
    ).toBe(before);
    expect(
      (
        await w.request.get("/api/v1/finance/milestone-links/" + linkId)
      ).headers()["cache-control"],
    ).toContain("no-store");
    await w.setViewportSize({ width: 390, height: 844 });
    expect(
      await w.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    expect(
      (
        await new AxeBuilder({ page: w })
          .withTags(["wcag2a", "wcag2aa"])
          .analyze()
      ).violations,
    ).toEqual([]);
    const m = await manager.newPage();
    await login(m, "e2e.finance.commercial.manager@example.test");
    await m.goto("/projects/" + projectId);
    await expect(
      m.getByRole("link", { name: "Project finance", exact: true }),
    ).toHaveCount(0);
    expect(await m.content()).not.toContain("SENSITIVE-COMMERCIAL-" + p);
    const denied = await m.request.get("/api/v1/finance/projects/" + projectId);
    expect(denied.status()).toBe(403);
    expect(await denied.text()).not.toContain("100.01");
  } finally {
    await reader.close();
    await manager.close();
    if (writerId)
      await f.sql.query(
        'DELETE FROM "FinanceGrant" WHERE "userId"=$1 AND "grantedById"=$2',
        [writerId, f.owner.id],
      );
    await f.close();
  }
});
