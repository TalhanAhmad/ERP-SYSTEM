import {
  commercialRead,
  commercialMutation,
} from "@/modules/finance/projects/http";
export const GET = (r: Request) => commercialRead(r, "MILESTONE");
export const POST = (r: Request) => commercialMutation(r, "MILESTONE_CREATE");
