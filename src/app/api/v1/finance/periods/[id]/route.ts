import { setupRead, setupMutation } from "@/modules/finance/accounting/http";
type Ctx = { params: Promise<{ id: string }> };
export const GET = async (request: Request, ctx: Ctx) =>
  setupRead(request, "periods", (await ctx.params).id);
export const PATCH = async (request: Request, ctx: Ctx) =>
  setupMutation(request, "PERIOD_UPDATE", (await ctx.params).id);
