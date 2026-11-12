import { ledgerRead, ledgerMutation } from "@/modules/finance/ledger/http";
type Context = { params: Promise<{ id: string }> };
export const GET = async (request: Request, c: Context) =>
  ledgerRead(request, (await c.params).id);
export const PATCH = async (request: Request, c: Context) =>
  ledgerMutation(request, "UPDATE", (await c.params).id);
