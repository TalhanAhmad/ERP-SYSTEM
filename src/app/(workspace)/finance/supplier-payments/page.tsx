import { PaymentRegister } from "@/modules/finance/components/supplier-pages";
export const dynamic = "force-dynamic";
export default function Page(props: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  return PaymentRegister({ ...props, resource: "PAYMENT" });
}
