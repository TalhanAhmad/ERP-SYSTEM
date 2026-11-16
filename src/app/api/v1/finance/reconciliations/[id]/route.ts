import { reconciliationRead } from "@/modules/finance/treasury/reconciliation/http";
export async function GET(r: Request, c: { params: Promise<{ id: string }> }) {
  return reconciliationRead(r, "REGISTER", (await c.params).id);
}
