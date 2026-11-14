import { assetMovementMutation } from "@/modules/finance/assets/lifecycle/http";
export const POST = (r: Request) => assetMovementMutation(r, "GENERATE");
