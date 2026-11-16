import { rollforwardRead } from "@/modules/finance/reports/rollforwards/http";
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return rollforwardRead(request, "SOURCE", (await params).id);
}
