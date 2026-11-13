import { PaymentRegister } from "@/modules/finance/components/supplier-pages";
export const dynamic = "force-dynamic";
export default function Page(p: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  return PaymentRegister({ ...p, resource: "ADVANCE_APPLICATION" });
}
