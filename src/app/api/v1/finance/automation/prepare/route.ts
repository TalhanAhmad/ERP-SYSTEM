import { automationMutation } from "@/modules/finance/automation/http";
export async function POST(request: Request) {
  return automationMutation(request, "PREPARE");
}
