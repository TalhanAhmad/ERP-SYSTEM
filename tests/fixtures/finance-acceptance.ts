import type { verifyFinanceReauthentication } from "@/modules/finance/access/reauth";
export type AcceptanceVerifier = () => ReturnType<
  typeof verifyFinanceReauthentication
>;
/** Real checked application services, synthetic books, and an explicit loopback test-only boundary. */
export async function seedAccountingAcceptance(verify: AcceptanceVerifier) {
  const target = new URL(process.env.DATABASE_URL!);
  if (
    target.pathname !== "/encova_test" ||
    !["localhost", "127.0.0.1"].includes(target.hostname)
  )
    throw Error(
      "Acceptance books require an isolated loopback encova_test database.",
    );
  const { db } = await import("@/server/db");
  if (await db.financeJournalEntry.count())
    throw Error(
      "Acceptance books require zero opening journals; retained history will not be cleared.",
    );
  const { setupCommand } = await import("@/modules/finance/accounting/service"),
    { masterCommand } = await import("@/modules/finance/masters/service"),
    { invoiceCommand } = await import("@/modules/finance/receivables/service"),
    { billCommand } = await import("@/modules/finance/payables/service"),
    { customerCommand } =
      await import("@/modules/finance/receivables/customer/service"),
    { supplierCommand } =
      await import("@/modules/finance/payables/supplier/service"),
    { movementCommand } = await import("@/modules/finance/treasury/service"),
    { loanCommand } = await import("@/modules/finance/funding/loans/service"),
    { holdingCommand } = await import("@/modules/finance/investments/service"),
    { assetCommand } = await import("@/modules/finance/assets/service");
  type Verified = Awaited<ReturnType<AcceptanceVerifier>>;
  const call = async <T>(fn: (v: Verified) => Promise<T>) => fn(await verify()),
    reason = "Deterministic F43 synthetic acceptance only";
  const account = async (code: string, patch: Record<string, unknown> = {}) =>
    (
      await call((v) =>
        setupCommand(
          v.actor,
          v.proof,
          "ACCOUNT_CREATE",
          {
            code: "F43." + code,
            name: "Acceptance " + code,
            type: "ASSET",
            normalSide: "DEBIT",
            reportGroup: "CURRENT_ASSETS",
            controlType: "NONE",
            currency: "PKR",
            parentId: null,
            isPosting: true,
            isContra: false,
            isCashEquivalent: false,
            reason,
            ...patch,
          },
          crypto.randomUUID(),
        ),
      )
    ).id;
  const accounts = {
    bank: await account("BANK", {
      controlType: "CASH",
      isCashEquivalent: true,
    }),
    petty: await account("PETTY", {
      controlType: "CASH",
      isCashEquivalent: true,
    }),
    ar: await account("AR", { controlType: "RECEIVABLES" }),
    ap: await account("AP", {
      type: "LIABILITY",
      normalSide: "CREDIT",
      reportGroup: "CURRENT_LIABILITIES",
      controlType: "PAYABLES",
    }),
    revenue: await account("REV", {
      type: "INCOME",
      normalSide: "CREDIT",
      reportGroup: "REVENUE",
    }),
    direct: await account("DIRECT", {
      type: "DIRECT_COST",
      reportGroup: "DIRECT_COSTS",
    }),
    expense: await account("EXP", {
      type: "OPERATING_EXPENSE",
      reportGroup: "OPERATING_EXPENSES",
    }),
    capital: await account("CAPITAL", {
      type: "EQUITY",
      normalSide: "CREDIT",
      reportGroup: "EQUITY",
      controlType: "CAPITAL",
    }),
    loan: await account("LOAN", {
      type: "LIABILITY",
      normalSide: "CREDIT",
      reportGroup: "NONCURRENT_LIABILITIES",
      controlType: "LOAN_PAYABLE",
    }),
    interest: await account("INTEREST", {
      type: "LIABILITY",
      normalSide: "CREDIT",
      reportGroup: "CURRENT_LIABILITIES",
      controlType: "INTEREST_PAYABLE",
    }),
    asset: await account("ASSET", {
      reportGroup: "NONCURRENT_ASSETS",
      controlType: "FIXED_ASSET",
    }),
    accumulated: await account("ACCUM", {
      reportGroup: "NONCURRENT_ASSETS",
      controlType: "ACCUMULATED_DEPRECIATION",
      normalSide: "CREDIT",
      isContra: true,
    }),
    investment: await account("INVEST", {
      reportGroup: "NONCURRENT_ASSETS",
      controlType: "INVESTMENT",
    }),
    investmentIncome: await account("INVREC", {
      controlType: "INVESTMENT_INCOME_RECEIVABLE",
    }),
    gain: await account("GAIN", {
      type: "OTHER_INCOME",
      normalSide: "CREDIT",
      reportGroup: "OTHER_INCOME",
    }),
    loss: await account("LOSS", {
      type: "OTHER_EXPENSE",
      reportGroup: "OTHER_EXPENSES",
    }),
    clientAdvance: await account("ADVCLIENT", {
      type: "LIABILITY",
      normalSide: "CREDIT",
      reportGroup: "CURRENT_LIABILITIES",
      controlType: "CLIENT_ADVANCE",
    }),
    supplierAdvance: await account("ADVSUPP", {
      controlType: "SUPPLIER_ADVANCE",
    }),
    retained: await account("RETAINED", {
      type: "EQUITY",
      normalSide: "CREDIT",
      reportGroup: "EQUITY",
    }),
  };
  const period = await call((v) =>
    setupCommand(
      v.actor,
      v.proof,
      "PERIOD_CREATE",
      {
        name: "F43 synthetic January2020",
        startDate: "2020-01-01",
        endDate: "2020-01-31",
        reason,
      },
      crypto.randomUUID(),
    ),
  );
  const party = async (kind: "CLIENT" | "SUPPLIER" | "OTHER") =>
    (
      await call((v) =>
        masterCommand(
          v.actor,
          v.proof,
          "PARTY_CREATE",
          {
            name: "F43 synthetic " + kind,
            legalName: "Synthetic Acceptance " + kind,
            kind,
            reason,
          },
          crypto.randomUUID(),
        ),
      )
    ).id;
  const client = await party("CLIENT"),
    supplier = await party("SUPPLIER"),
    founder = await party("OTHER"),
    cash = async (name: string, kind: "BANK" | "CASH", gl: string) =>
      (
        await call((v) =>
          masterCommand(
            v.actor,
            v.proof,
            "CASH_CREATE",
            { name, kind, glAccountId: gl, currency: "PKR", reason },
            crypto.randomUUID(),
          ),
        )
      ).id,
    bank = await cash("F43 acceptance bank", "BANK", accounts.bank),
    petty = await cash("F43 acceptance petty cash", "CASH", accounts.petty);
  const owner = (await verify()).actor,
    project = await db.project.create({
      data: {
        name: "F43 synthetic project",
        description: "Acceptance contribution and cash traceability",
        managerId: owner.id,
      },
    });
  const loan = await call((v) =>
    loanCommand(
      v.actor,
      v.proof,
      "CREATE",
      {
        name: "F43 founder principal agreement",
        partyId: founder,
        direction: "RECEIVED",
        startDate: "2020-01-01",
        maturityDate: "2030-12-31",
        agreedPrincipal: "100000.00",
        annualRate: null,
        agreement:
          "Acceptance fixture principal only; no interest accrual is assumed",
        principalAccountId: accounts.loan,
        interestAccountId: accounts.interest,
        interestResultAccountId: accounts.loss,
        reason,
      },
      crypto.randomUUID(),
    ),
  );
  const holding = await call((v) =>
    holdingCommand(
      v.actor,
      v.proof,
      "CREATE",
      {
        name: "F43 synthetic cost holding",
        partyId: founder,
        investmentType: "Synthetic amount-based holding",
        unitMode: "AMOUNT",
        classification: "NONCURRENT",
        policyStatus: "REVIEWED",
        measurementMode: "COST",
        valuationTreatment: "PROFIT_LOSS",
        policy:
          "Acceptance acquisition cost only, without income or valuation movement",
        evidence: "Synthetic reviewed acquisition evidence",
        investmentAccountId: accounts.investment,
        gainAccountId: accounts.gain,
        lossAccountId: accounts.loss,
        feeAccountId: accounts.expense,
        incomeAccountId: accounts.gain,
        incomeControlAccountId: accounts.investmentIncome,
        valuationOffsetAccountId: null,
        impairmentAccountId: accounts.loss,
        reason,
      },
      crypto.randomUUID(),
    ),
  );
  const movement = async (body: Record<string, unknown>) => {
    const d = await call((v) =>
      movementCommand(
        v.actor,
        v.proof,
        "CREATE",
        {
          description: "F43 actual synthetic source",
          evidence: "Original deterministic acceptance evidence",
          currency: "PKR",
          reason,
          ...body,
        },
        crypto.randomUUID(),
      ),
    );
    const p = await call((v) =>
      movementCommand(
        v.actor,
        v.proof,
        "POST",
        { id: d.id, expectedVersion: d.version, reason },
        crypto.randomUUID(),
      ),
    );
    return { ...d, journalId: p.journalId };
  };
  const capital = await movement({
    kind: "CAPITAL_CONTRIBUTION",
    reference: "F43-CAPITAL",
    documentDate: "2020-01-02",
    postingDate: "2020-01-02",
    partyId: founder,
    toCashId: bank,
    controlAccountId: accounts.capital,
    amount: "500000.00",
  });
  const borrowing = await movement({
    kind: "LOAN_DISBURSEMENT",
    reference: "F43-LOAN-DRAW",
    documentDate: "2020-01-03",
    postingDate: "2020-01-03",
    loanId: loan.id,
    toCashId: bank,
    amount: "100000.00",
  });
  const invoice = await call((v) =>
    invoiceCommand(
      v.actor,
      v.proof,
      "CREATE",
      {
        reference: "F43-EARNED-INVOICE",
        partyId: client,
        receivableAccountId: accounts.ar,
        projectId: project.id,
        invoiceDate: "2020-01-04",
        postingDate: "2020-01-04",
        dueDate: "2020-01-31",
        description: "Earned acceptance services",
        evidence: "Services delivered and accepted",
        currency: "PKR",
        lines: [
          {
            description: "Earned service",
            quantity: "1",
            unitRate: "300000.00",
            recognition: "EARNED",
            revenueAccountId: accounts.revenue,
            projectId: project.id,
          },
        ],
        reason,
      },
      crypto.randomUUID(),
    ),
  );
  const invoicePost = await call((v) =>
    invoiceCommand(
      v.actor,
      v.proof,
      "POST",
      { id: invoice.id, expectedVersion: invoice.version, reason },
      crypto.randomUUID(),
    ),
  );
  const receipt = await call((v) =>
    customerCommand(
      v.actor,
      v.proof,
      "RECEIPT",
      "CREATE",
      {
        reference: "F43-PARTIAL-RECEIPT",
        partyId: client,
        cashAccountId: bank,
        projectId: project.id,
        documentDate: "2020-01-05",
        postingDate: "2020-01-05",
        description: "Partial actual client collection",
        evidence: "Bank evidence for exact collection",
        cashAmount: "200000.00",
        allocations: [{ invoiceId: invoice.id, amount: "200000.00" }],
        reason,
      },
      crypto.randomUUID(),
    ),
  );
  const receiptPost = await call((v) =>
    customerCommand(
      v.actor,
      v.proof,
      "RECEIPT",
      "POST",
      { id: receipt.id, expectedVersion: receipt.version, reason },
      crypto.randomUUID(),
    ),
  );
  const bill = await call((v) =>
    billCommand(
      v.actor,
      v.proof,
      "CREATE",
      {
        kind: "BILL",
        reference: "F43-CONTRACTOR-BILL",
        partyId: supplier,
        payableAccountId: accounts.ap,
        projectId: project.id,
        billDate: "2020-01-06",
        postingDate: "2020-01-06",
        dueDate: "2020-01-31",
        description: "Acceptance contractor services",
        evidence: "Original contractor bill",
        lines: [
          {
            description: "Contractor direct cost",
            quantity: "1",
            unitRate: "120000.00",
            treatment: "EXPENSE",
            costAccountId: accounts.direct,
            projectId: project.id,
          },
        ],
        reason,
      },
      crypto.randomUUID(),
    ),
  );
  const billPost = await call((v) =>
    billCommand(
      v.actor,
      v.proof,
      "POST",
      { id: bill.id, expectedVersion: bill.version, reason },
      crypto.randomUUID(),
    ),
  );
  const payment = await call((v) =>
    supplierCommand(
      v.actor,
      v.proof,
      "PAYMENT",
      "CREATE",
      {
        reference: "F43-PARTIAL-PAYMENT",
        partyId: supplier,
        cashAccountId: bank,
        projectId: project.id,
        documentDate: "2020-01-07",
        postingDate: "2020-01-07",
        description: "Partial contractor settlement",
        evidence: "Bank evidence for exact supplier payment",
        cashAmount: "90000.00",
        allocations: [{ billId: bill.id, amount: "90000.00" }],
        reason,
      },
      crypto.randomUUID(),
    ),
  );
  const paymentPost = await call((v) =>
    supplierCommand(
      v.actor,
      v.proof,
      "PAYMENT",
      "POST",
      { id: payment.id, expectedVersion: payment.version, reason },
      crypto.randomUUID(),
    ),
  );
  const equipment = await call((v) =>
    billCommand(
      v.actor,
      v.proof,
      "CREATE",
      {
        kind: "EXPENSE",
        reference: "F43-EQUIPMENT-PURCHASE",
        partyId: supplier,
        cashAccountId: bank,
        payableAccountId: null,
        billDate: "2020-01-08",
        postingDate: "2020-01-08",
        dueDate: "2020-01-08",
        description: "Company equipment paid from bank",
        evidence: "Original capital equipment purchase",
        lines: [
          {
            description: "Capital equipment",
            quantity: "1",
            unitRate: "60000.00",
            treatment: "ASSET",
            costAccountId: accounts.asset,
          },
        ],
        reason,
      },
      crypto.randomUUID(),
    ),
  );
  const equipmentPost = await call((v) =>
    billCommand(
      v.actor,
      v.proof,
      "POST",
      { id: equipment.id, expectedVersion: equipment.version, reason },
      crypto.randomUUID(),
    ),
  );
  const equipmentLine = await db.financeBillLine.findFirstOrThrow({
      where: { billId: equipment.id },
    }),
    asset = await call((v) =>
      assetCommand(
        v.actor,
        v.proof,
        "CREATE",
        {
          tag: "F43-EQUIPMENT",
          description: "Acceptance equipment",
          location: "Synthetic office",
          custodianId: null,
          billLineId: equipmentLine.id,
          fundingMovementId: null,
          inServiceDate: "2020-01-08",
          cost: "60000.00",
          usefulLifeMonths: 60,
          residualValue: "0.00",
          depreciationMethod: "STRAIGHT_LINE",
          convention: "PENDING",
          firstDepMonth: null,
          policyEvidence: null,
          reason,
        },
        crypto.randomUUID(),
      ),
    );
  const investment = await movement({
    kind: "INVESTMENT_ACQUISITION",
    reference: "F43-INVESTMENT",
    documentDate: "2020-01-09",
    postingDate: "2020-01-09",
    holdingId: holding.id,
    fromCashId: bank,
    amount: "50000.00",
  });
  const repayment = await movement({
    kind: "LOAN_REPAYMENT",
    reference: "F43-LOAN-REPAY",
    documentDate: "2020-01-10",
    postingDate: "2020-01-10",
    loanId: loan.id,
    fromCashId: bank,
    amount: "25000.00",
  });
  const { cashFlowReview, cashFlowConfirm } =
    await import("@/modules/finance/reports/cash-flow/service");
  // Explicit synthetic fixture classifications use the same fresh-owner review path; never guess them in production.
  for (const [journalId, category] of [
    [capital.journalId, "FINANCING"],
    [borrowing.journalId, "FINANCING"],
    [receiptPost.journalId, "OPERATING"],
    [paymentPost.journalId, "OPERATING"],
    [equipmentPost.journalId, "INVESTING"],
    [investment.journalId, "INVESTING"],
    [repayment.journalId, "FINANCING"],
  ] as const) {
    if (!journalId)
      throw Error("Acceptance source did not produce its required journal.");
    const review = await cashFlowReview(owner, { journalId });
    await call((v) =>
      cashFlowConfirm(
        v.actor,
        v.proof,
        {
          journalId,
          basisHash: review.basisHash,
          expectedReviewId: null,
          expectedVersion: null,
          components: review.lines.map((l) => ({
            journalLineId: l.id,
            category,
            amount: l.amount,
          })),
          evidence:
            "Explicit classification from the deterministic acceptance scenario",
          reason,
        },
        crypto.randomUUID(),
      ),
    );
  }
  return {
    accounts,
    period,
    client,
    supplier,
    founder,
    bank,
    petty,
    project,
    loan,
    holding,
    asset,
    invoice,
    bill,
    equipment,
    sourceIds: [
      capital.id,
      borrowing.id,
      invoice.id,
      receipt.id,
      bill.id,
      payment.id,
      equipment.id,
      investment.id,
      repayment.id,
    ],
    journalIds: [
      capital.journalId,
      borrowing.journalId,
      invoicePost.journalId,
      receiptPost.journalId,
      billPost.journalId,
      paymentPost.journalId,
      equipmentPost.journalId,
      investment.journalId,
      repayment.journalId,
    ],
    cutoff: "2020-01-10",
  };
}
