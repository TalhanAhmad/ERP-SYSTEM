import { matchRead } from "@/modules/finance/treasury/matching/http";
export const GET = (r: Request) => matchRead(r, "OPTIONS");
