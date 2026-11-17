import { exportMutation } from "@/modules/finance/reports/exports/http";
export const runtime = "nodejs";
export const maxDuration = 60;
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return exportMutation(request, "RETRY", (await params).id);
}
