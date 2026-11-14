import { statementTransport } from "@/modules/finance/treasury/statements/http";
type C = { params: Promise<{ id: string }> };
export const POST = async (r: Request, c: C) =>
  statementTransport(r, (await c.params).id);
