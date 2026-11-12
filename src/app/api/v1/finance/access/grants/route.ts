import { accessMutation } from "@/modules/finance/access/http";
import { grantSchema } from "@/modules/finance/access/schemas";
export const POST = (request: Request) =>
  accessMutation(request, "GRANT", grantSchema);
