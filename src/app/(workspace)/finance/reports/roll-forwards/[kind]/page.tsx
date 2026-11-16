import { RollforwardReportPage } from "@/modules/finance/components/rollforward-reports";
export const dynamic = "force-dynamic";
export default function Page(props: {
  params: Promise<{ kind: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  return <RollforwardReportPage {...props} />;
}
