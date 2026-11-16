import { cashFlowRead } from "@/modules/finance/reports/cash-flow/http";
export async function GET(request: Request) {
  return cashFlowRead(request, "REPORT");
}
