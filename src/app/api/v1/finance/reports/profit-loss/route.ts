import { statementReportRead } from "@/modules/finance/reports/statements/http";
export const GET = (r: Request) => statementReportRead(r, "PROFIT_LOSS");
