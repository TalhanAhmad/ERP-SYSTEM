import {
  customerRead,
  customerMutation,
} from "@/modules/finance/receivables/customer/http";
export const GET = (r: Request) => customerRead(r, "CUSTOMER_CREDIT");
export const POST = (r: Request) =>
  customerMutation(r, "CUSTOMER_CREDIT", "CREATE");
