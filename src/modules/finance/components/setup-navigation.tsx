import Link from "next/link";
export function FinanceNavigation() {
  return (
    <nav aria-label="Finance navigation" className="form-actions">
      <Link href="/finance">Finance</Link>
      <Link href="/finance/customer-credits">Credits</Link>
      <Link href="/finance/customer-refunds">Refunds</Link>
      <Link href="/finance/receipt-unallocations">Settlement releases</Link>
      <Link href="/finance/advance-applications">Apply advances</Link>
      <Link href="/finance/receipts">Receipts</Link>
      <Link href="/finance/supplier-payments">Supplier payments</Link>
      <Link href="/finance/supplier-applications">Supplier advances</Link>
      <Link href="/finance/supplier-credits">Supplier credits</Link>
      <Link href="/finance/supplier-refunds">Supplier refunds</Link>
      <Link href="/finance/supplier-releases">Payment releases</Link>
      <Link href="/finance/tax-codes">Tax policies</Link>
      <Link href="/finance/bills">Bills &amp; expenses</Link>
      <Link href="/finance/invoices">Invoices</Link>
      <Link href="/finance/journals">Journals</Link>
      <Link href="/finance/parties">Parties</Link>
      <Link href="/finance/cash-accounts">Cash accounts</Link>
      <Link href="/finance/accounts">Accounts</Link>
      <Link href="/finance/periods">Periods</Link>
      <Link href="/finance/access">Access</Link>
    </nav>
  );
}
export function SetupHistory({
  events,
}: {
  events: {
    id: string;
    action: string;
    reason: string;
    createdAt: Date;
    actor: { displayName: string };
  }[];
}) {
  return (
    <section className="panel" aria-label="Record history">
      <h2>History</h2>
      <div
        className="table-wrap"
        role="region"
        aria-label="Record history table"
        tabIndex={0}
      >
        <table>
          <thead>
            <tr>
              <th scope="col">Action</th>
              <th scope="col">Person</th>
              <th scope="col">Reason</th>
              <th scope="col">Time (Pakistan)</th>
            </tr>
          </thead>
          <tbody>
            {events.map((e) => (
              <tr key={e.id}>
                <td>{e.action.replaceAll("_", " ").toLowerCase()}</td>
                <td>{e.actor.displayName}</td>
                <td>{e.reason}</td>
                <td>
                  {new Intl.DateTimeFormat("en-GB", {
                    timeZone: "Asia/Karachi",
                    dateStyle: "medium",
                    timeStyle: "short",
                  }).format(e.createdAt)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
