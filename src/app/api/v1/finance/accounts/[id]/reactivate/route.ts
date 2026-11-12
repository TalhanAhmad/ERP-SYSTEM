import { setupMutation } from "@/modules/finance/accounting/http";
export const POST = async (
  request: Request,
  ctx: { params: Promise<{ id: string }> },
) => setupMutation(request, "ACCOUNT_REACTIVATE", (await ctx.params).id);
