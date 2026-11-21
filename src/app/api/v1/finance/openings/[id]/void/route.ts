import { openingMutation } from "@/modules/finance/opening/http";
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  return openingMutation(request, "VOID", id);
}
