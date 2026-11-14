import { loanMutation } from "@/modules/finance/funding/loans/http";
export const POST = async (
  r: Request,
  c: { params: Promise<{ id: string }> },
) => loanMutation(r, "ARCHIVE", (await c.params).id);
