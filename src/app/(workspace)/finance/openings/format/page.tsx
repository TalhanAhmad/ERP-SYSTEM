import Link from "next/link";
import { financePageData } from "@/modules/finance/accounting/page-data";
import { FinanceNavigation } from "@/modules/finance/components/setup-navigation";
export const dynamic = "force-dynamic";
const sample = {
  formatVersion: 1,
  name: "Reviewed company opening",
  currency: "PKR",
  cutoverDate: "YYYY-MM-DD",
  clearingAccountId: "REVIEWED_OPENING_CLEARING_ACCOUNT_UUID",
  evidence: "Original source and reconciliation evidence",
  trialBalance: [
    { accountId: "ASSET_ACCOUNT_UUID", debit: "100.00", credit: "0.00" },
    { accountId: "EQUITY_ACCOUNT_UUID", debit: "0.00", credit: "100.00" },
  ],
  items: [],
};
export default async function OpeningFormat() {
  await financePageData(async () => null);
  return (
    <section>
      <FinanceNavigation />
      <h1>Opening file preparation</h1>
      <p>
        Prepare one reviewed UTF-8 JSON file without a byte-order mark. Use
        decimal strings and actual private account/register IDs. The example
        shows file structure; its placeholders and amounts are not company
        settings.
      </p>
      <section className="panel">
        <h2>File header and trial balance</h2>
        <pre className="preline">{JSON.stringify(sample, null, 2)}</pre>
        <p>
          Maximum 180 KB, 200 nonzero trial-balance accounts and 200 detailed
          positions. Use one positive debit or credit on each trial-balance row.
          Select an equity account with the Opening clearing control type. Do
          not include that clearing account in the imported trial balance.
        </p>
        <p>
          <Link href="/finance/accounts">Account setup and IDs</Link> ·{" "}
          <Link href="/finance/parties">Original parties</Link> ·{" "}
          <Link href="/finance/loans">Reviewed loan registers</Link> ·{" "}
          <Link href="/finance/holdings">Reviewed investment holdings</Link>
        </p>
      </section>
      <section className="panel">
        <h2>Detailed control positions</h2>
        <p>
          Every item supplies kind, accountId, positive amount, originalDate,
          reference and description. Each control account must match its
          trial-balance total exactly. Trial-balance controls are posted through
          their detail, once.
        </p>
        <ul>
          <li>
            AR/AP: partyId and original dueDate; imports only the outstanding
            amount, not a newly issued invoice or purchase.
          </li>
          <li>
            CASH: cashAccountId for the mapped bank/cash register. Use side
            CREDIT only for a bank overdraft with an explicitly reviewed
            current-liability presentation policy. Other cash balances use
            DEBIT.
          </li>
          <li>
            LOAN_PRINCIPAL/LOAN_INTEREST: loanId with reviewed
            principal/interest mappings.
          </li>
          <li>
            INVESTMENT: holdingId, original costBasis, cutover carrying amount
            and units for a unit holding. INVESTMENT_INCOME: holdingId and
            outstanding income-control amount.
          </li>
          <li>
            ASSET: original gross amount, secondaryAccountId for accumulated
            depreciation, accumulatedDepreciation, tag, location, inServiceDate,
            residualValue, remainingLifeMonths, firstDepMonth and
            policyEvidence. Future charges use the remaining carrying amount and
            reviewed remaining life.
          </li>
          <li>
            CAPITAL, DISTRIBUTION, FOUNDER_PAYABLE: original partyId and the
            matching protected control.
          </li>
          <li>
            CLIENT_ADVANCE/SUPPLIER_ADVANCE: partyId and the matching advance
            control; imports no fictitious cash receipt or payment.
          </li>
          <li>
            DEFERRED: partyId, resultAccountId and receivableAccountId for a
            settled legacy obligation. It creates the unearned balance without a
            second receivable or sale.
          </li>
        </ul>
      </section>
      <section className="panel">
        <h2>Review before posting</h2>
        <p>
          The cutover must be the first open accounting date, and the ledger
          must be empty. Confirm the original file, totals, references, due
          dates and accounting policies before the Finance Owner approves. A
          posted opening cannot be imported again. Posting before cutover is
          unavailable; later actual activity uses the existing workflows.
        </p>
      </section>
      <Link href="/finance/openings">Back to opening imports</Link>
    </section>
  );
}
