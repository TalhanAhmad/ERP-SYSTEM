import {
  reconciliationRead,
  reconciliationMutation,
} from "@/modules/finance/treasury/reconciliation/http";
export const GET = (r: Request) => reconciliationRead(r, "REGISTER");
export const POST = (r: Request) => reconciliationMutation(r, "CREATE");
