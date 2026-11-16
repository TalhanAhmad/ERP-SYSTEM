import { AgeingHistoryPage } from "@/modules/finance/components/ageing-reports";
export const dynamic = "force-dynamic";
export default function Page(props: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  return <AgeingHistoryPage side="AP" {...props} />;
}
