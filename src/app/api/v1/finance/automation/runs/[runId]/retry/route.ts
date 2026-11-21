import { automationMutation } from "@/modules/finance/automation/http";
export async function POST(
  request: Request,
  { params }: { params: Promise<{ runId: string }> },
) {
  const { runId } = await params;
  return automationMutation(request, "RETRY", runId);
}
