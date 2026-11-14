import {
  supplierRead,
  supplierMutation,
} from "@/modules/finance/payables/supplier/http";
export const GET = (r: Request) => supplierRead(r, "ADVANCE_APPLICATION");
export const POST = (r: Request) =>
  supplierMutation(r, "ADVANCE_APPLICATION", "CREATE");
