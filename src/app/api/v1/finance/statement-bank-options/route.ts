import { statementRead } from "@/modules/finance/treasury/statements/http";
export const GET = (r: Request) => statementRead(r, "BANK");
