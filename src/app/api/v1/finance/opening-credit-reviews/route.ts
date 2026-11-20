import {
  automationMutation,
  automationRead,
} from "@/modules/finance/automation/http";
export async function GET(request: Request) {
  return automationRead(request, "CREDIT_REVIEWS");
}
export async function POST(request: Request) {
  return automationMutation(request, "OPENING_CREDIT_REVIEW");
}
