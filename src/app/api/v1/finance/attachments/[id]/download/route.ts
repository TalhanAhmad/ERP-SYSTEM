import { fileRead } from "@/modules/finance/documents/files/http";
export const GET = async (r: Request, c: { params: Promise<{ id: string }> }) =>
  fileRead(r, (await c.params).id, true);
