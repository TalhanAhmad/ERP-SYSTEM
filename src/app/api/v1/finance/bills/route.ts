import { billRead, billMutation } from "@/modules/finance/payables/http";
export const GET = (r: Request) => billRead(r);
export const POST = (r: Request) => billMutation(r, "CREATE");
