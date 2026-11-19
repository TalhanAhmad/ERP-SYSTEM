import { closingMutation } from "@/modules/finance/closing/http";
export const runtime = "nodejs";
export const maxDuration = 60;
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const p = await params;
  return closingMutation(request, "CLOSE", p.id);
}
