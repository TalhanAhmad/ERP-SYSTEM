import { closingMutation } from "@/modules/finance/closing/http";
export const runtime = "nodejs";
export const maxDuration = 60;
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string; closeId: string }> },
) {
  const p = await params;
  return closingMutation(request, "EXPORT", p.id, p.closeId);
}
