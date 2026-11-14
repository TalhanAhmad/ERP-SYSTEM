import {
  statementMutation,
} from "@/modules/finance/treasury/statements/http";
export const POST = (r: Request) => statementMutation(r, "RESERVE");
