import { cashFlowRead } from "@/modules/finance/reports/cash-flow/http";
export async function GET(
  request: Request,
  { params }: { params: Promise<{ journalId: string }> },
) {
  return cashFlowRead(request, "REVIEW", (await params).journalId);
}
