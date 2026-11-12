import { masterRead, masterMutation } from "@/modules/finance/masters/http";
export const GET = (r: Request) => masterRead(r, "cash-accounts");
export const POST = (r: Request) => masterMutation(r, "CASH_CREATE");
