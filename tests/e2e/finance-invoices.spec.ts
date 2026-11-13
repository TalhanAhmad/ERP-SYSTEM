import { test, expect } from "@playwright/test";
import { financeFixture } from "./finance-fixture";
import { login } from "./helpers";
test("selected administrator bills mixed earned/deferred lines through private versioned API", async ({
  page,
  browser,
}) => {
  test.setTimeout(90000);
  const base = String(test.info().project.use.baseURL),
    fixture = await financeFixture(page, base, "e2e.finance.invoices"),
    prefix = "B11." + crypto.randomUUID().slice(0, 7).toUpperCase();
  const writerContext = await browser.newContext(),
    memberContext = await browser.newContext();
  try {
    const ar = await fixture.seedAccount(prefix + ".AR", {
        controlType: "RECEIVABLES",
      }),
      revenue = await fixture.seedAccount(prefix + ".REV", {
        type: "INCOME",
        normalSide: "CREDIT",
        reportGroup: "REVENUE",
      }),
      deferred = await fixture.seedAccount(prefix + ".DEFER", {
        type: "LIABILITY",
        normalSide: "CREDIT",
        reportGroup: "CURRENT_LIABILITIES",
        controlType: "DEFERRED_REVENUE",
      }),
      period = await fixture.historicalPeriod(prefix + " period");
    const partyBody = {
        name: prefix + " client",
        legalName: "Synthetic Client Legal Co",
        kind: "CLIENT",
        contactEmail: "synthetic@example.test",
        phone: null,
        address: "Original evidence address",
        userId: null,
        reason: "Explicit synthetic client",
      },
      party = await fixture.create("parties", partyBody);
    const writer = await writerContext.newPage();
    await login(writer, "e2e.finance.invoice.writer@example.test");
    const request = async (
      path: string,
      body: unknown,
      key = crypto.randomUUID(),
    ) =>
      writer.request.post("/api/v1/finance/invoices" + path, {
        headers: { Origin: base, "X-Encova-CSRF": "1", "Idempotency-Key": key },
        data: { ...(body as object), reauth: { password: fixture.password } },
      });
    const input = {
      reference: prefix,
      partyId: party.id,
      receivableAccountId: ar.id,
      projectId: null,
      invoiceDate: period.start,
      postingDate: period.start,
      dueDate: period.end,
      description: "Mixed synthetic service",
      evidence: "Browser API fixture only",
      currency: "PKR",
      reason: "Reviewed synthetic billing",
      lines: [
        {
          description: "Earned service",
          quantity: "2",
          unitRate: "100.005",
          discountAmount: "0.01",
          recognition: "EARNED",
          revenueAccountId: revenue.id,
          deferredAccountId: null,
        },
        {
          description: "Future service",
          quantity: "1",
          unitRate: "50.005",
          discountAmount: "0.01",
          recognition: "DEFERRED",
          revenueAccountId: revenue.id,
          deferredAccountId: deferred.id,
        },
      ],
    };
    const created = await request("", input);
    expect(created.status()).toBe(201);
    expect(created.headers()["cache-control"]).toContain("no-store");
    const d = (await created.json()).data;
    expect(d.number).toMatch(/^INV-\d{10}$/);
    const key = crypto.randomUUID(),
      post = { expectedVersion: 1, reason: "Post reviewed synthetic billing" };
    const posted = await request("/" + d.id + "/post", post, key);
    expect(posted.status()).toBe(200);
    const replay = await request("/" + d.id + "/post", post, key);
    expect(await replay.json()).toEqual(await posted.json());
    const response = await writer.request.get(
      "/api/v1/finance/invoices/" + d.id,
    );
    expect(response.status()).toBe(200);
    expect(response.headers()["vary"]).toContain("Cookie");
    const view = (await response.json()).data;
    expect(view.item).toMatchObject({
      state: "POSTED",
      version: 2,
      lineAmount: "250.02",
      discountAmount: "0.02",
      totalAmount: "250.00",
    });
    expect(
      view.item.entry.lines.map((l: { debit: string; credit: string }) => [
        l.debit,
        l.credit,
      ]),
    ).toEqual([
      ["250.00", "0.00"],
      ["0.00", "200.00"],
      ["0.00", "50.00"],
    ]);
    expect(view.item.receivableEvents[0]).toMatchObject({
      amount: "250.00",
      effectiveDate: period.start,
    });
    expect(view.deferredEvents[0]).toMatchObject({
      kind: "BILLED",
      amount: "50.00",
    });
    const original = view.item.partySnapshot;
    const changed = await page.request.patch(
      "/api/v1/finance/parties/" + party.id,
      {
        headers: {
          Origin: base,
          "X-Encova-CSRF": "1",
          "Idempotency-Key": crypto.randomUUID(),
        },
        data: {
          ...partyBody,
          name: prefix + " renamed",
          address: "Corrected current address",
          expectedVersion: 1,
          reauth: { password: fixture.password },
        },
      },
    );
    expect(changed.status()).toBe(200);
    expect(
      (
        await (
          await writer.request.get("/api/v1/finance/invoices/" + d.id)
        ).json()
      ).data.item.partySnapshot,
    ).toEqual(original);
    const forged = await request("", { ...input, totalAmount: "0.01" });
    expect(forged.status()).toBe(422);
    const stale = await request("/" + d.id + "/void", {
      expectedVersion: 1,
      reason: "Stale browser check",
    });
    expect(stale.status()).toBe(409);
    const member = await memberContext.newPage();
    await login(member, "e2e.member@example.test");
    const denied = await member.request.get("/api/v1/finance/invoices/" + d.id);
    expect(denied.status()).toBe(403);
    expect(denied.headers()["cache-control"]).toContain("no-store");
    const listing = await writer.request.get(
      "/api/v1/finance/invoices?q=" + prefix,
    );
    expect((await listing.json()).data).toMatchObject({
      total: 1,
      totals: { totalAmount: "250.00" },
    });
  } finally {
    await fixture.close();
    await writerContext.close();
    await memberContext.close();
  }
});
