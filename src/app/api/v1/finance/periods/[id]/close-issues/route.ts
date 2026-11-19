import { closingRead, closingMutation } from "@/modules/finance/closing/http";
export const runtime = "nodejs";
export const maxDuration = 60;
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const p = await params;
  return closingRead(request, "ISSUES", p.id);
}
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const p = await params;
  return closingMutation(request, "ISSUE_CREATE", p.id);
}
