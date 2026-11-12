import { ledgerMutation } from "@/modules/finance/ledger/http";
export const POST = (request: Request) => ledgerMutation(request, "BULK_VOID");
