import { coreReportRead } from "@/modules/finance/reports/http";
export const GET = (request: Request) =>
  coreReportRead(request, "TRIAL_BALANCE");
