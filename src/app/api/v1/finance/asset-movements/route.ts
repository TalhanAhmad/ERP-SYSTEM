import {
  assetMovementRead,
  assetMovementMutation,
} from "@/modules/finance/assets/lifecycle/http";
export const GET = (r: Request) => assetMovementRead(r);
export const POST = (r: Request) => assetMovementMutation(r, "CREATE");
