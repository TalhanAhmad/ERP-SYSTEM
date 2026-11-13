import { NewPayment } from "@/modules/finance/components/supplier-pages";
export const dynamic = "force-dynamic";
export default function Page() {
  return NewPayment({ resource: "ADVANCE_APPLICATION" });
}
