import { accessMutation } from "@/modules/finance/access/http";
import { transferActionSchema } from "@/modules/finance/access/schemas";
export async function POST(
  request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  return accessMutation(request, "CANCEL", transferActionSchema, {
    transferId: (await ctx.params).id,
  });
}
