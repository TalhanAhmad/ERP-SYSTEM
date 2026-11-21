import { openingRead } from "@/modules/finance/opening/http";
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  return openingRead(request, "LINES", id);
}
