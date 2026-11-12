import { MasterListPage } from "@/modules/finance/components/master-pages";
export const dynamic = "force-dynamic";
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  return <MasterListPage resource="cash-accounts" raw={await searchParams} />;
}
