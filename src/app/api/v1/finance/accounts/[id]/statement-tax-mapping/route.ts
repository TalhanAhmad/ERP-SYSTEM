import { statementReportRead } from "@/modules/finance/reports/statements/http";
export async function GET(r: Request, c: { params: Promise<{ id: string }> }) {
  return statementReportRead(r, "TAX_MAPPING", (await c.params).id);
}
