import Link from "next/link";
import type { ExportRequest } from "../reports/exports/schemas";
export function ReportExportLink({
  reportType,
  filters,
}: {
  reportType: ExportRequest["reportType"];
  filters: Record<string, unknown>;
}) {
  const q = new URLSearchParams({ reportType });
  for (const [k, v] of Object.entries(filters))
    if (!["page", "issuePage"].includes(k) && v !== undefined && v !== null)
      q.set(k, String(v));
  return (
    <p>
      <Link href={"/finance/exports/new?" + q}>
        Export this report to CSV / PDF
      </Link>
    </p>
  );
}
