import { statementMutation } from "@/modules/finance/treasury/statements/http";
type C = { params: Promise<{ id: string }> };
export const POST = async (r: Request, c: C) =>
  statementMutation(r, "CANCEL", (await c.params).id);
