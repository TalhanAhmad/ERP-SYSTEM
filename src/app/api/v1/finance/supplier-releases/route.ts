import { supplierRead } from "@/modules/finance/payables/supplier/http";
export const GET = (r: Request) => supplierRead(r, "UNALLOCATION");
