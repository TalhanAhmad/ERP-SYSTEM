import { assetRead, assetMutation } from "@/modules/finance/assets/http";
export const GET = (r: Request) => assetRead(r);
export const POST = (r: Request) => assetMutation(r, "CREATE");
