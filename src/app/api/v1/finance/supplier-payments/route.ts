import {
  supplierRead,
  supplierMutation,
} from "@/modules/finance/payables/supplier/http";
export const GET = (r: Request) => supplierRead(r, "PAYMENT");
export const POST = (r: Request) => supplierMutation(r, "PAYMENT", "CREATE");
