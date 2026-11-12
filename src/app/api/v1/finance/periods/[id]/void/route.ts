import { setupMutation } from "@/modules/finance/accounting/http";
export const POST = async (
  request: Request,
  ctx: { params: Promise<{ id: string }> },
) => setupMutation(request, "PERIOD_VOID", (await ctx.params).id);
