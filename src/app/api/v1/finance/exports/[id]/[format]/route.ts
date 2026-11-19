import { exportRead } from "@/modules/finance/reports/exports/http";
export const runtime = "nodejs";
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string; format: string }> },
) {
  const p = await params;
  return exportRead(request, p.id, p.format);
}
