import { coreReportRead } from "@/modules/finance/reports/http";
export const GET = (request: Request) =>
  coreReportRead(request, "ACCOUNT_OPTIONS");
