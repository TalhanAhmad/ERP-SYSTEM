import { taxRead, taxMutation } from "@/modules/finance/taxes/http";
export const GET = (r: Request) => taxRead(r);
export const POST = (r: Request) => taxMutation(r, "CREATE");
