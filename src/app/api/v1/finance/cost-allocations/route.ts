import { costRead, costMutation } from "@/modules/finance/projects/costs/http";
export const GET = (r: Request) => costRead(r, "ALLOCATION");
export const POST = (r: Request) => costMutation(r, "CREATE");
