import {
  customerRead,
  customerMutation,
} from "@/modules/finance/receivables/customer/http";
export const GET = (r: Request) => customerRead(r, "CUSTOMER_REFUND");
export const POST = (r: Request) =>
  customerMutation(r, "CUSTOMER_REFUND", "CREATE");
