import {
  commercialRead,
  commercialMutation,
} from "@/modules/finance/projects/http";
export const GET = (r: Request) => commercialRead(r, "PROFILE");
export const POST = (r: Request) => commercialMutation(r, "PROFILE_CREATE");
