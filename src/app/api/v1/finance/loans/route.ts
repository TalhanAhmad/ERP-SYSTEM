import { loanRead, loanMutation } from "@/modules/finance/funding/loans/http";
export const GET = (r: Request) => loanRead(r);
export const POST = (r: Request) => loanMutation(r, "CREATE");
