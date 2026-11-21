import { automationRead } from "@/modules/finance/automation/http";
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  return automationRead(request, "SCHEDULE", id);
}
