import { automationRead } from "@/modules/finance/automation/http";
export async function GET(
  request: Request,
  { params }: { params: Promise<{ runId: string }> },
) {
  const { runId } = await params;
  return automationRead(request, "RUN", runId);
}
