import { AgeingReportPage } from "@/modules/finance/components/ageing-reports";
export const dynamic = "force-dynamic";
export default function Page(props: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  return <AgeingReportPage side="AP" {...props} />;
}
