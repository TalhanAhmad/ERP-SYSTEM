import { commercialMutation } from "@/modules/finance/projects/http";
type C = { params: Promise<{ id: string }> };
export const POST = async (r: Request, c: C) =>
  commercialMutation(r, "PROFILE_ACTIVATE", (await c.params).id);
