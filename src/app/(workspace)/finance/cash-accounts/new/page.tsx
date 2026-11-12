import { NewMasterPage } from "@/modules/finance/components/master-pages";
export const dynamic = "force-dynamic";
export default function Page() {
  return <NewMasterPage resource="cash-accounts" />;
}
