import { matchMutation } from "@/modules/finance/treasury/matching/http";
export async function POST(r: Request, c: { params: Promise<{ id: string }> }) {
  return matchMutation(r, "UNMATCH", (await c.params).id);
}
