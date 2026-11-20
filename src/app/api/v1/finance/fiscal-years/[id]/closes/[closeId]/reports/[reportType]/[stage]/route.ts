import { yearRead } from "@/modules/finance/year-closing/http";
export async function GET(
  request: Request,
  {
    params,
  }: {
    params: Promise<{
      id: string;
      closeId: string;
      reportType: string;
      stage: string;
    }>;
  },
) {
  const p = await params;
  return yearRead(request, "REPORT", p.id, p.closeId, p.reportType, p.stage);
}
