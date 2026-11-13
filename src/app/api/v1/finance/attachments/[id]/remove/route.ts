import { fileMutation } from "@/modules/finance/documents/files/http";
export const POST = async (
  r: Request,
  c: { params: Promise<{ id: string }> },
) => fileMutation(r, "REMOVE", (await c.params).id);
