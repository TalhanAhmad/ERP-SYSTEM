import { commercialMutation } from "@/modules/finance/projects/http";
type C = { params: Promise<{ id: string }> };
export const POST = async (r: Request, c: C) =>
  commercialMutation(r, "VARIATION_VOID", (await c.params).id);
