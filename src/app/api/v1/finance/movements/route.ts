import {
  movementRead,
  movementMutation,
} from "@/modules/finance/treasury/http";
export const GET = (r: Request) => movementRead(r);
export const POST = (r: Request) => movementMutation(r, "CREATE");
