import { masterMutation } from "@/modules/finance/masters/http";
export const POST = async (
  r: Request,
  c: { params: Promise<{ id: string }> },
) => masterMutation(r, "CASH_REACTIVATE", (await c.params).id);
