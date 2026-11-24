import { PaymentDetail } from "@/modules/finance/components/supplier-pages";
export const dynamic = "force-dynamic";
export default function Page(props: { params: Promise<{ id: string }> }) {
  return PaymentDetail({ ...props, resource: "PAYMENT" });
}
