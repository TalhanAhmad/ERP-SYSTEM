import { masterRead, masterMutation } from "@/modules/finance/masters/http";
export const GET = (r: Request) => masterRead(r, "parties");
export const POST = (r: Request) => masterMutation(r, "PARTY_CREATE");
