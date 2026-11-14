import { assetRead } from "@/modules/finance/assets/http";
export const GET = (r: Request) => assetRead(r, undefined, true);
