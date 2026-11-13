import { NewReceipt } from "@/modules/finance/components/customer-pages";
export const dynamic = "force-dynamic";
export default function Page() {
  return NewReceipt({ resource: "ADVANCE_APPLICATION" });
}
