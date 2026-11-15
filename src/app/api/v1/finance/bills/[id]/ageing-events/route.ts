import { ageingRead } from "@/modules/finance/reports/ageing/http";
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return ageingRead(request, "AP", (await params).id);
}
