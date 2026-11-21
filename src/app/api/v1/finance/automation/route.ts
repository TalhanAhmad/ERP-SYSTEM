import {
  automationMutation,
  automationRead,
} from "@/modules/finance/automation/http";
export async function GET(request: Request) {
  return automationRead(request, "SCHEDULES");
}
export async function POST(request: Request) {
  return automationMutation(request, "CREATE");
}
