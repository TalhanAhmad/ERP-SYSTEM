import { masterMutation } from "@/modules/finance/masters/http";
export const POST = async (
  r: Request,
  c: { params: Promise<{ id: string }> },
) => masterMutation(r, "PARTY_ARCHIVE", (await c.params).id);
