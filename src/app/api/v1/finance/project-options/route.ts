import { commercialRead } from "@/modules/finance/projects/http";
export const GET = (r: Request) => commercialRead(r, "OPTIONS");
