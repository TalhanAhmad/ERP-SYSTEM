import { closingMutation } from "@/modules/finance/closing/http";
export const runtime = "nodejs";
export const maxDuration = 60;
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string; issueId: string }> },
) {
  const p = await params;
  return closingMutation(request, "ISSUE_RESOLVE", p.id, p.issueId);
}
