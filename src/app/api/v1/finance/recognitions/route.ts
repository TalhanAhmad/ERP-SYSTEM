import {
  automationMutation,
  automationRead,
} from "@/modules/finance/automation/http";
export async function GET(request: Request) {
  return automationRead(request, "RECOGNITIONS");
}
export async function POST(request: Request) {
  return automationMutation(request, "RECOGNITION_CREATE");
}
