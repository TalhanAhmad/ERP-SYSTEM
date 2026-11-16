import {
  commercialRead,
  commercialMutation,
} from "@/modules/finance/projects/http";
type C = { params: Promise<{ id: string }> };
export const GET = async (r: Request, c: C) =>
  commercialRead(r, "PROFILE", (await c.params).id);
export const PATCH = async (r: Request, c: C) =>
  commercialMutation(r, "PROFILE_UPDATE", (await c.params).id);
