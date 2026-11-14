import {
  commercialRead,
  commercialMutation,
} from "@/modules/finance/projects/http";
export const GET = (r: Request) => commercialRead(r, "VARIATION");
export const POST = (r: Request) => commercialMutation(r, "VARIATION_CREATE");
