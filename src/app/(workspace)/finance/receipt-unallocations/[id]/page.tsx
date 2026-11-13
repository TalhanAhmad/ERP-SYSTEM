import { ReceiptDetail } from "@/modules/finance/components/customer-pages";
export const dynamic = "force-dynamic";
export default function Page(p: { params: Promise<{ id: string }> }) {
  return ReceiptDetail({ ...p, resource: "UNALLOCATION" });
}
