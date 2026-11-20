import { automationMutation } from "@/modules/finance/automation/http";
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  return automationMutation(request, "RECOGNITION_POST", id);
}
