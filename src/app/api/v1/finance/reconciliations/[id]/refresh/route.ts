import { reconciliationMutation } from "@/modules/finance/treasury/reconciliation/http";
export async function POST(r: Request, c: { params: Promise<{ id: string }> }) {
  return reconciliationMutation(r, "REFRESH", (await c.params).id);
}
