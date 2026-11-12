import Link from "next/link";
import { env } from "@/server/env";
import { DetailDrawerLink } from "./detail-drawer";
export function FinanceRegister({
  label,
  columns,
  rows,
  page,
  pages,
  total,
  href,
  children,
  totals,
}: {
  label: string;
  columns: string[];
  rows: {
    id: string;
    name: string;
    href: string;
    endpoint: string;
    cells: React.ReactNode[];
  }[];
  page: number;
  pages: number;
  total: number;
  href: (page: number) => string;
  children: React.ReactNode;
  totals?: React.ReactNode;
}) {
  const plural = label === "Party" ? "parties" : label.toLowerCase() + "s";
  return (
    <section className="panel" aria-label={label + " register"}>
      {children}
      <p>
        {total} matching {plural} · Page {page} of {pages}
      </p>
      {totals}
      <div
        className="table-wrap"
        role="region"
        aria-label={label + " table"}
        tabIndex={0}
      >
        <table>
          <thead>
            <tr>
              {columns.map((c) => (
                <th key={c} scope="col">
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td>
                  <DetailDrawerLink
                    href={r.href}
                    endpoint={r.endpoint}
                    hosted={env.AUTH_PROVIDER === "supabase"}
                  >
                    {r.name}
                  </DetailDrawerLink>
                </td>
                {r.cells.map((c, i) => (
                  <td key={i}>{c}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!rows.length && (
        <p>
          No records match this view. Clear filters or create a record if you
          have permission.
        </p>
      )}
      <nav aria-label={label + " pagination"} className="form-actions">
        {page > 1 && <Link href={href(page - 1)}>Previous {plural}</Link>}
        {page < pages && <Link href={href(page + 1)}>Next {plural}</Link>}
      </nav>
    </section>
  );
}
