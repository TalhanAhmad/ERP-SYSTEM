import {
  supplierRead,
  supplierMutation,
} from "@/modules/finance/payables/supplier/http";
export const GET = (r: Request) => supplierRead(r, "SUPPLIER_REFUND");
export const POST = (r: Request) =>
  supplierMutation(r, "SUPPLIER_REFUND", "CREATE");
