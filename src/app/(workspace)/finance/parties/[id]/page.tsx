import { MasterDetailPage } from "@/modules/finance/components/master-pages";
export const dynamic = "force-dynamic";
export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  return <MasterDetailPage resource="parties" id={(await params).id} />;
}
