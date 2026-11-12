import { ledgerRead, ledgerMutation } from "@/modules/finance/ledger/http";
export const GET = (request: Request) => ledgerRead(request);
export const POST = (request: Request) => ledgerMutation(request, "CREATE");
