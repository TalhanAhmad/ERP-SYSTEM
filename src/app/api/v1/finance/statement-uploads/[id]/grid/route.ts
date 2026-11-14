import { statementRead } from "@/modules/finance/treasury/statements/http";
type C = { params: Promise<{ id: string }> };
export const GET = async (r: Request, c: C) =>
  statementRead(r, "GRID", (await c.params).id);
