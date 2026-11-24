import { ReceiptDetail } from "@/modules/finance/components/customer-pages";
export const dynamic = "force-dynamic";
export default function Page(props: { params: Promise<{ id: string }> }) {
  return ReceiptDetail({ ...props, resource: "RECEIPT" });
}
