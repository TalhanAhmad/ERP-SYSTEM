import { closingRead } from "@/modules/finance/closing/http";
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string; closeId: string }> },
) {
  const p = await params;
  return closingRead(request, "DETAIL", p.id, p.closeId);
}
