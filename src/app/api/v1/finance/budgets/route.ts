import {
  planningRead,
  planningMutation,
} from "@/modules/finance/planning/http";
export const GET = (r: Request) => planningRead(r, "BUDGET");
export const POST = (r: Request) => planningMutation(r, "BUDGET_CREATE");
