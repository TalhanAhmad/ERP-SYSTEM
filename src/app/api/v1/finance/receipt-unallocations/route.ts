import { customerRead } from "@/modules/finance/receivables/customer/http";
export const GET = (r: Request) => customerRead(r, "UNALLOCATION");
