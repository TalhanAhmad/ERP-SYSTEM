import { commercialRead } from "@/modules/finance/projects/http";
type C = { params: Promise<{ id: string }> };
export const GET = async (r: Request, c: C) =>
  commercialRead(r, "LINK", (await c.params).id);
