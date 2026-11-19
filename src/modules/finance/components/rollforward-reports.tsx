import { ReportExportLink } from "./report-export-link";
import Link from "next/link";
import { workDate } from "@/lib/dates";
import { financePageData } from "../accounting/page-data";
import {
  rollforward,
  rollforwardHistory,
} from "../reports/rollforwards/service";
import {
  rollforwardKinds,
  rollforwardKindSchema,
  rollforwardQuerySchema,
} from "../reports/rollforwards/schemas";
import { FinanceNavigation } from "./setup-navigation";
import { ReportMetadataPanel, FinancialSourceLink } from "./report-primitives";
import { RollforwardAmount } from "./rollforward-amount";
import { MoneyCell } from "./money-cell";
export const rollforwardTitles: Record<string, string> = {
  PROJECTS: "Project results",
  FUNDING: "Founder funding",
  LOANS: "Loan balances",
  INVESTMENTS: "Investments",
  ASSETS: "Fixed assets",
  ADVANCES: "Customer and supplier advances",
};
const labels: Record<string, string> = {
  INCOME: "Earned income",
  DIRECT_COST: "Direct costs",
  OVERHEAD: "Assigned / shared overhead",
  CONTRIBUTION: "Income less direct costs",
  NET_RESULT: "Result after assigned / shared overhead",
  NET_BILLED: "Net earned and deferred billing",
  DEFERRED_BILLING: "Deferred billing",
  CAPITAL: "Capital",
  DISTRIBUTION: "Distributions",
  FOUNDER_PAYABLE: "Founder payable",
  RECEIVED_PRINCIPAL: "Borrowed principal",
  ADVANCED_PRINCIPAL: "Lent principal",
  RECEIVED_INTEREST: "Interest payable",
  ADVANCED_INTEREST: "Interest receivable",
  COST: "Cost basis",
  CARRYING: "Carrying balance",
  UNITS: "Holding units",
  INCOME_RECEIVABLE: "Investment income receivable",
  DEPRECIATION: "Accumulated depreciation",
  CLIENT_ADVANCE: "Client advances and credits",
  SUPPLIER_ADVANCE: "Supplier advances and credits",
};
const metricLabel = (v: string) =>
  labels[v] ?? v.replaceAll("_", " ").toLowerCase();
const columns = [
  "openingBalance",
  "increases",
  "decreases",
  "periodNet",
  "closingBalance",
] as const;
type Props = {
  params: Promise<{ kind: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
};
export async function RollforwardReportPage({ params, searchParams }: Props) {
  const { kind } = await params,
    raw = await searchParams,
    today = workDate(),
    input = {
      ...raw,
      from: raw.from ?? today.slice(0, 7) + "-01",
      to: raw.to ?? today,
    },
    p = rollforwardQuerySchema.safeParse(input),
    d = await financePageData((a) => {
      rollforwardKindSchema.parse(kind);
      return p.success ? rollforward(a, kind, p.data) : Promise.resolve(null);
    });
  const href = (page: number, issuePage = d?.reconciliation.page ?? 1) =>
    "?" +
    new URLSearchParams({
      from: input.from,
      to: input.to,
      q: raw.q ?? "",
      page: String(page),
      issuePage: String(issuePage),
    });
  const history = (rowKey: string) =>
    "/finance/reports/roll-forwards/" +
    kind +
    "/events?" +
    new URLSearchParams({ from: input.from, to: input.to, rowKey });
  return (
    <section>
      <FinanceNavigation />
      <h1>{rollforwardTitles[kind]} roll-forward</h1>
      <nav aria-label="Roll-forward views" className="form-actions">
        {rollforwardKinds.map((k) => (
          <Link
            key={k}
            aria-current={kind === k ? "page" : undefined}
            href={
              "/finance/reports/roll-forwards/" +
              k +
              "?" +
              new URLSearchParams({ from: input.from, to: input.to })
            }
          >
            {rollforwardTitles[k]}
          </Link>
        ))}
      </nav>
      <section className="panel">
        <form method="get" className="form-grid">
          <label>
            Posting start date
            <input
              name="from"
              type="date"
              min="0001-01-01"
              max="9999-12-31"
              defaultValue={input.from}
              required
            />
          </label>
          <label>
            Posting end date
            <input
              name="to"
              type="date"
              min="0001-01-01"
              max="9999-12-31"
              defaultValue={input.to}
              required
            />
          </label>
          <label>
            Filter displayed balances
            <input name="q" defaultValue={raw.q ?? ""} maxLength={100} />
          </label>
          <button>Show roll-forward</button>
        </form>
        {!p.success && (
          <p role="alert" className="error">
            Check the posting range, display filter and pages.
          </p>
        )}
      </section>
      {d && (
        <>
          <ReportExportLink
            reportType="ROLL_FORWARD"
            filters={{ ...input, kind }}
          />
          <ReportMetadataPanel
            metadata={d.metadata}
            sourceNote="Opening precedes the start date; posted signed increases and decreases within the inclusive range lead to closing. Planning amounts, draft charges and later reversals do not replace actual dated events."
          />
          <section className="panel">
            <h2>Complete company metrics</h2>
            <p>
              Each metric is separate. Cost and carrying value are not added
              together, borrowed and lent principal remain separate, and unlike
              holding units have no company grand total. Search and pagination
              affect displayed balances only.
            </p>
            {kind === "PROJECTS" && (
              <p>
                Posted earned results exclude YEAR_CLOSE transfers. Net billing
                includes billed deferred amounts; it is separate from earned
                income. Company unassigned costs remain visible beside project
                assignments. These results are not a project balance sheet.
              </p>
            )}
            {kind === "FUNDING" && (
              <p>
                Capital, distributions and founder liabilities include actual
                cash and noncash postings. Founder outlays retain their reviewed
                liability classification.
              </p>
            )}
            {kind === "ASSETS" && (
              <p>
                Current retained asset registrations assign actual historical
                purchase cost. Purchases not assigned to the register remain in
                posted asset controls and appear as explicit control issues.
                Actual depreciation includes every accumulated-depreciation
                control used by dated movements.
              </p>
            )}
            <div
              className="table-wrap"
              role="region"
              aria-label="Complete roll-forward metrics"
              tabIndex={0}
            >
              <table>
                <thead>
                  <tr>
                    <th scope="col">Metric</th>
                    <th scope="col">Opening (PKR)</th>
                    <th scope="col">Increases (PKR)</th>
                    <th scope="col">Decreases (PKR)</th>
                    <th scope="col">Period net (PKR)</th>
                    <th scope="col">Closing (PKR)</th>
                  </tr>
                </thead>
                <tbody>
                  {d.totals.map((t) => (
                    <tr key={t.metric}>
                      <th scope="row">{metricLabel(t.metric)}</th>
                      {columns.map((c) => (
                        <td key={c}>
                          <MoneyCell value={t[c]} />
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {!d.totals.length && <p>No actual metrics exist at this cutoff.</p>}
          </section>
          <section className="panel" aria-label="Roll-forward control checks">
            <h2>
              {d.reconciliation.ready
                ? "Roll-forward and book checks pass"
                : "Roll-forward review required"}
            </h2>
            <p>
              {d.reconciliation.controlCount} control accounts ·{" "}
              {d.reconciliation.issueCount} issues ·{" "}
              {d.reconciliation.negativeRowCount} negative balances. All account
              differences are checked independently before display filtering.
            </p>
            <p>
              Opening book difference{" "}
              <MoneyCell value={d.reconciliation.openingBookDifference} /> ·
              Closing book difference{" "}
              <MoneyCell value={d.reconciliation.closingBookDifference} />
            </p>
            <p className="preline">
              Event proof {String(d.metadata.filters.eventDigest)}
            </p>
            <p>
              These checks compare actual source and ledger balances. Final
              financial export also requires the other presentation, bank and
              subledger checks.
            </p>
            {!!d.reconciliation.issueCount && (
              <>
                <div
                  className="table-wrap"
                  role="region"
                  aria-label="Roll-forward control issues"
                  tabIndex={0}
                >
                  <table>
                    <thead>
                      <tr>
                        <th scope="col">Issue</th>
                        <th scope="col">Opening source</th>
                        <th scope="col">Opening GL</th>
                        <th scope="col">Opening difference</th>
                        <th scope="col">Closing source</th>
                        <th scope="col">Closing GL</th>
                        <th scope="col">Closing difference</th>
                      </tr>
                    </thead>
                    <tbody>
                      {d.reconciliation.issues.map((i) => (
                        <tr key={i.issueKey}>
                          <td>
                            {i.accountId ? (
                              <Link
                                href={
                                  "/finance/reports/general-ledger?" +
                                  new URLSearchParams({
                                    accountId: i.accountId,
                                    from: input.from,
                                    to: input.to,
                                  })
                                }
                              >
                                {i.label}
                              </Link>
                            ) : i.rowKey ? (
                              <Link href={history(i.rowKey)}>{i.label}</Link>
                            ) : (
                              i.label
                            )}
                            <p>
                              {i.scope === "ACCOUNT"
                                ? "Source / control agreement"
                                : i.scope === "NEGATIVE_ROW"
                                  ? "Review negative source balance"
                                  : "Review actual book balance"}
                            </p>
                          </td>
                          {(
                            [
                              "openingSubledger",
                              "openingControl",
                              "openingDifference",
                              "closingSubledger",
                              "closingControl",
                              "closingDifference",
                            ] as const
                          ).map((c) => (
                            <td key={c}>
                              {i[c] === null ? (
                                "—"
                              ) : (
                                <RollforwardAmount
                                  value={i[c]}
                                  unit={i.metric === "UNITS" ? "UNITS" : "PKR"}
                                />
                              )}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p>
                  Issue page {d.reconciliation.page} of {d.reconciliation.pages}
                </p>
                <div className="form-actions">
                  {d.reconciliation.page > 1 && (
                    <Link href={href(d.page, d.reconciliation.page - 1)}>
                      Previous roll-forward issues
                    </Link>
                  )}
                  {d.reconciliation.page < d.reconciliation.pages && (
                    <Link href={href(d.page, d.reconciliation.page + 1)}>
                      Next roll-forward issues
                    </Link>
                  )}
                </div>
              </>
            )}
          </section>
          <section className="panel">
            <h2>Actual balances by source</h2>
            <p>
              {d.total} matching balances · Page {d.page} of {d.pages}. Zero
              balances with no activity in this range are omitted from the
              display.
            </p>
            <div
              className="table-wrap"
              role="region"
              aria-label="Posted roll-forward balances"
              tabIndex={0}
            >
              <table>
                <thead>
                  <tr>
                    <th scope="col">Source / metric</th>
                    <th scope="col">Opening</th>
                    <th scope="col">Increases</th>
                    <th scope="col">Decreases</th>
                    <th scope="col">Period net</th>
                    <th scope="col">Closing</th>
                    <th scope="col">History</th>
                  </tr>
                </thead>
                <tbody>
                  {d.items.map((i) => (
                    <tr key={i.rowKey}>
                      <td>
                        {i.entityHref ? (
                          <Link href={i.entityHref}>
                            {i.number ? i.number + " · " : ""}
                            {i.name}
                          </Link>
                        ) : (
                          i.name
                        )}
                        {i.active ? "" : " (archived)"}
                        <p>
                          {metricLabel(i.metric)} · {i.accountCount} source
                          accounts
                        </p>
                      </td>
                      {columns.map((c) => (
                        <td key={c}>
                          <RollforwardAmount value={i[c]} unit={i.unit} />
                        </td>
                      ))}
                      <td>
                        <Link href={history(i.rowKey)}>View source events</Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {!d.total && (
              <p>
                No balances match this display; complete company metrics and
                control checks remain above.
              </p>
            )}
            <div className="form-actions">
              {d.page > 1 && (
                <Link href={href(d.page - 1)}>
                  Previous roll-forward balances
                </Link>
              )}
              {d.page < d.pages && (
                <Link href={href(d.page + 1)}>Next roll-forward balances</Link>
              )}
            </div>
          </section>
        </>
      )}
    </section>
  );
}
export async function RollforwardHistoryPage({ params, searchParams }: Props) {
  const { kind } = await params,
    q = await searchParams,
    d = await financePageData((a) => rollforwardHistory(a, kind, q)),
    base = "/finance/reports/roll-forwards/" + kind,
    href = (page: number) =>
      "?" +
      new URLSearchParams({
        from: d.metadata.from,
        to: d.metadata.to,
        rowKey: d.dimension.rowKey,
        page: String(page),
      });
  return (
    <section>
      <FinanceNavigation />
      <h1>Roll-forward source events</h1>
      <section className="panel">
        <h2>
          {d.dimension.name} · {metricLabel(d.dimension.metric)}
        </h2>
        <p>
          Opening{" "}
          <RollforwardAmount value={d.openingBalance} unit={d.dimension.unit} />{" "}
          · Closing{" "}
          <RollforwardAmount value={d.closingBalance} unit={d.dimension.unit} />
        </p>
        <p>
          Running balances include earlier dates and event pages. Within one
          accounting date, actual posting time and stable source keys determine
          order. A source event without a journal is a retained nonposting
          register/policy event.
        </p>
        {d.dimension.entityHref && (
          <Link href={d.dimension.entityHref}>Open current source record</Link>
        )}
      </section>
      <ReportMetadataPanel
        metadata={d.metadata}
        sourceNote="This history retains actual dated source components and their signed opposites, with prior-period and earlier-page carry."
      />
      <section className="panel">
        <h2>Actual dated events</h2>
        <p>
          {d.total} events · Page {d.page} of {d.pages}
        </p>
        <div
          className="table-wrap"
          role="region"
          aria-label="Roll-forward source event ledger"
          tabIndex={0}
        >
          <table>
            <thead>
              <tr>
                <th scope="col">Effective date</th>
                <th scope="col">Actual source</th>
                <th scope="col">Account</th>
                <th scope="col">Change</th>
                <th scope="col">Running balance</th>
              </tr>
            </thead>
            <tbody>
              {d.items.map((i) => (
                <tr key={i.eventKey}>
                  <td>{i.effectiveDate}</td>
                  <td>
                    <FinancialSourceLink
                      journalId={i.journalId}
                      type={i.sourceType}
                      id={i.sourceId}
                      reference={i.reference}
                    />
                    <p>{i.description}</p>
                  </td>
                  <td>
                    {i.code ? i.code + " · " + i.accountName : "Derived metric"}
                  </td>
                  <td>
                    <RollforwardAmount
                      value={i.amount}
                      unit={d.dimension.unit}
                    />
                  </td>
                  <td>
                    <RollforwardAmount
                      value={i.runningBalance}
                      unit={d.dimension.unit}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="form-actions">
          {d.page > 1 && (
            <Link href={href(d.page - 1)}>Previous source events</Link>
          )}
          {d.page < d.pages && (
            <Link href={href(d.page + 1)}>Next source events</Link>
          )}
        </div>
      </section>
      <Link
        href={
          base +
          "?" +
          new URLSearchParams({ from: d.metadata.from, to: d.metadata.to })
        }
      >
        Back to {rollforwardTitles[kind].toLowerCase()}
      </Link>
    </section>
  );
}
