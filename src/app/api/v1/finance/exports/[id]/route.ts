import { exportRead } from "@/modules/finance/reports/exports/http";
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return exportRead(request, (await params).id);
}
