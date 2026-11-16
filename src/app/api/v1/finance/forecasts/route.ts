import {
  planningRead,
  planningMutation,
} from "@/modules/finance/planning/http";
export const GET = (r: Request) => planningRead(r, "FORECAST");
export const POST = (r: Request) => planningMutation(r, "FORECAST_CREATE");
