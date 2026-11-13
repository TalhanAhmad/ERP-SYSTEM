import { movementRead } from "@/modules/finance/treasury/http";
export const GET = (r: Request) => movementRead(r, undefined, true);
