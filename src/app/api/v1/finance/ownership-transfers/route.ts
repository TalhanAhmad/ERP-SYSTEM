import { accessMutation } from "@/modules/finance/access/http";
import { transferSchema } from "@/modules/finance/access/schemas";
export const POST = (request: Request) =>
  accessMutation(request, "TRANSFER", transferSchema);
