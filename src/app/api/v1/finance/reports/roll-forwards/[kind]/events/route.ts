import { rollforwardRead } from "@/modules/finance/reports/rollforwards/http";
export async function GET(
  request: Request,
  { params }: { params: Promise<{ kind: string }> },
) {
  return rollforwardRead(request, "HISTORY", (await params).kind);
}
