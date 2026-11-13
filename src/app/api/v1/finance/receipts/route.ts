import {
  customerRead,
  customerMutation,
} from "@/modules/finance/receivables/customer/http";
export const GET = (r: Request) => customerRead(r, "RECEIPT");
export const POST = (r: Request) => customerMutation(r, "RECEIPT", "CREATE");
