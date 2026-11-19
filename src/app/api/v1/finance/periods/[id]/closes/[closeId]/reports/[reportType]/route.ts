import { closingRead } from "@/modules/finance/closing/http";
export async function GET(
  request: Request,
  {
    params,
  }: { params: Promise<{ id: string; closeId: string; reportType: string }> },
) {
  const p = await params;
  return closingRead(request, "REPORT", p.id, p.closeId, p.reportType);
}
