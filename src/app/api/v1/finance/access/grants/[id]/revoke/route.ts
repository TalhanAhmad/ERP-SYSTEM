import { accessMutation } from "@/modules/finance/access/http";
import { revokeSchema } from "@/modules/finance/access/schemas";
export async function POST(
  request: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const id = (await ctx.params).id;
  return accessMutation(request, "REVOKE", revokeSchema, { grantId: id });
}
