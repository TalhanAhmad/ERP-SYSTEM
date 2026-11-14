import {
  holdingRead,
  holdingMutation,
} from "@/modules/finance/investments/http";
export const GET = (r: Request) => holdingRead(r);
export const POST = (r: Request) => holdingMutation(r, "CREATE");
