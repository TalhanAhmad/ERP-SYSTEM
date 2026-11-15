import { cashFlowMutation } from "@/modules/finance/reports/cash-flow/http";
export async function POST(request: Request) {
  return cashFlowMutation(request);
}
