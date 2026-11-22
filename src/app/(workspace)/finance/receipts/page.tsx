import { ReceiptRegister } from "@/modules/finance/components/customer-pages";
export const dynamic = "force-dynamic";
export default function Page(props: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  return ReceiptRegister({ ...props, resource: "RECEIPT" });
}
