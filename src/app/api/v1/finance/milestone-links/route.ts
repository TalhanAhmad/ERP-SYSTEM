import { commercialMutation } from "@/modules/finance/projects/http";
export const POST = (r: Request) => commercialMutation(r, "LINK_CREATE");
