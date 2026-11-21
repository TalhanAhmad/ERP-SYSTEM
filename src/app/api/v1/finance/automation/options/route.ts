import { automationRead } from "@/modules/finance/automation/http";
export async function GET(request: Request) {
  return automationRead(request, "OPTIONS");
}
