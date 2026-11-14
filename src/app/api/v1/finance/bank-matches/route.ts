import {
  matchRead,
  matchMutation,
} from "@/modules/finance/treasury/matching/http";
export const GET = (r: Request) => matchRead(r, "MATCH");
export const POST = (r: Request) => matchMutation(r, "MATCH");
