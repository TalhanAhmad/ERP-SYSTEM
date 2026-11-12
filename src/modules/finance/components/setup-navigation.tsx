import Link from "next/link";
export function FinanceNavigation() {
  return (
    <nav aria-label="Finance navigation" className="form-actions">
      <Link href="/finance">Finance</Link>
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
