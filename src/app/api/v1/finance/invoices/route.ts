import {
  invoiceRead,
  invoiceMutation,
} from "@/modules/finance/receivables/http";
export const GET = (r: Request) => invoiceRead(r);
export const POST = (r: Request) => invoiceMutation(r, "CREATE");
