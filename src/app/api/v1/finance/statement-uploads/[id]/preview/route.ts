import { statementPreview } from "@/modules/finance/treasury/statements/http";
type C = { params: Promise<{ id: string }> };
export const POST = async (r: Request, c: C) =>
  statementPreview(r, (await c.params).id);
