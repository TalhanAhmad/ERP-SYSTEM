import { setupRead, setupMutation } from "@/modules/finance/accounting/http";
export const dynamic = "force-dynamic";
export const GET = (request: Request) => setupRead(request, "periods");
export const POST = (request: Request) =>
  setupMutation(request, "PERIOD_CREATE");
