import {
  commercialRead,
  commercialMutation,
} from "@/modules/finance/projects/http";
type C = { params: Promise<{ id: string }> };
export const GET = async (r: Request, c: C) =>
  commercialRead(r, "MILESTONE", (await c.params).id);
export const PATCH = async (r: Request, c: C) =>
  commercialMutation(r, "MILESTONE_UPDATE", (await c.params).id);
