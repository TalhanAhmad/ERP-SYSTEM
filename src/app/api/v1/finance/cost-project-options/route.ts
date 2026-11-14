import { costRead } from "@/modules/finance/projects/costs/http";
export const GET = (r: Request) => costRead(r, "PROJECT");
