import { yearRead } from "@/modules/finance/year-closing/http";
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string; closeId: string }> },
) {
  const p = await params;
  return yearRead(request, "DETAIL", p.id, p.closeId);
}
