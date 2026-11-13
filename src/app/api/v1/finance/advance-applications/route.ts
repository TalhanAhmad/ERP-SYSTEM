import {
  customerRead,
  customerMutation,
} from "@/modules/finance/receivables/customer/http";
export const GET = (r: Request) => customerRead(r, "ADVANCE_APPLICATION");
export const POST = (r: Request) =>
  customerMutation(r, "ADVANCE_APPLICATION", "CREATE");
