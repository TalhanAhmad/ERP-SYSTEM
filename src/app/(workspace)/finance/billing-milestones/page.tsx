import { CommercialRegisterPage } from "@/modules/finance/components/commercial-register-page";
export const dynamic = "force-dynamic";
export default async function Register({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  return <CommercialRegisterPage kind="MILESTONE" raw={await searchParams} />;
}
