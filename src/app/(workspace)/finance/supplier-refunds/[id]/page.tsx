import { PaymentDetail } from "@/modules/finance/components/supplier-pages";
export const dynamic = "force-dynamic";
export default function Page(p: { params: Promise<{ id: string }> }) {
  return PaymentDetail({ ...p, resource: "SUPPLIER_REFUND" });
}
