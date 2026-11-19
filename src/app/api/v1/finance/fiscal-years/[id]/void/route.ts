import { yearMutation } from "@/modules/finance/year-closing/http";
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const p = await params;
  return yearMutation(request, "VOID", p.id);
}
