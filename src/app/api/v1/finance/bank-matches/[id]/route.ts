import { matchRead } from "@/modules/finance/treasury/matching/http";
export async function GET(r: Request, c: { params: Promise<{ id: string }> }) {
  return matchRead(r, "MATCH", (await c.params).id);
}
