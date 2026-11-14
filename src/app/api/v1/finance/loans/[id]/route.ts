import { loanRead, loanMutation } from "@/modules/finance/funding/loans/http";
type C = { params: Promise<{ id: string }> };
export const GET = async (r: Request, c: C) => loanRead(r, (await c.params).id);
export const PATCH = async (r: Request, c: C) =>
  loanMutation(r, "UPDATE", (await c.params).id);
