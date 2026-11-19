import Link from "next/link";
import { financePageData } from "@/modules/finance/accounting/page-data";
import { exportRegister } from "@/modules/finance/reports/exports/service";
import { reportLabels } from "@/modules/finance/reports/exports/schemas";
import { FinanceNavigation } from "@/modules/finance/components/setup-navigation";
export const dynamic = "force-dynamic";
export default async function Exports({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const q = await searchParams,
    d = await financePageData((a) => exportRegister(a, q));
  return (
    <section>
      <FinanceNavigation />
      <h1>Report exports</h1>
      <section className="panel">
        <p>
          Private CSV/PDF copies preserve their generated snapshot. Access is
          checked again for every download; download availability ends after 24
          hours.
        </p>
        <Link href="/finance/exports/new" className="primary">
          Prepare export
        </Link>
      </section>
      <section className="panel">
        <div
          className="table-wrap"
          role="region"
          aria-label="Export register"
          tabIndex={0}
        >
          <table>
            <thead>
              <tr>
                <th scope="col">Report</th>
                <th scope="col">Purpose</th>
                <th scope="col">Status</th>
                <th scope="col">Created</th>
                <th scope="col">Download expiry</th>
              </tr>
            </thead>
            <tbody>
              {d.items.map((i) => (
                <tr key={i.id}>
                  <th scope="row">
                    <Link href={"/finance/exports/" + i.id}>
                      {reportLabels[i.reportType]}
                    </Link>
                  </th>
                  <td>{i.mode}</td>
                  <td>{i.state.toLowerCase()}</td>
                  <td>{i.createdAt}</td>
                  <td>{i.expiresAt}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!d.items.length && <p>No report exports yet.</p>}
        <p>
          Page {d.page} of {d.pages} · {d.total} exports
        </p>
        {d.page > 1 && (
          <Link href={"?page=" + (d.page - 1)}>Previous exports</Link>
        )}
        {d.page < d.pages && (
          <Link href={"?page=" + (d.page + 1)}>Next exports</Link>
        )}
      </section>
    </section>
  );
}
