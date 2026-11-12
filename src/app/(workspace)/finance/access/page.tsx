import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { context } from "@/server/context";
import { env } from "@/server/env";
import { AppError } from "@/server/errors";
import { financeAccessSnapshot } from "@/modules/finance/access/service";
import { requireFinanceEnabled } from "@/modules/finance/access/policy";
import { FinanceAccessPanel } from "@/modules/finance/components/access-panel";
export const dynamic = "force-dynamic";
export default async function FinanceAccessPage() {
  const snapshot = await (async () => {
    try {
      requireFinanceEnabled();
      return await financeAccessSnapshot(await context());
    } catch (error) {
      if (error instanceof AppError) {
        if (error.status === 401) redirect("/login");
        if (error.code === "MFA_REQUIRED") redirect("/security");
        if ([403, 404].includes(error.status)) notFound();
      }
      throw error;
    }
  })();
  return (
    <section>
      <p className="eyebrow">FINANCE · ACCESS</p>
      <h1>Finance access</h1>
      <p>
        <Link href="/finance">Back to Finance</Link>
      </p>
      <FinanceAccessPanel
        key={`${snapshot.settings?.version}:${snapshot.transfers.map((t) => `${t.id}:${t.version}`).join()}`}
        snapshot={snapshot}
        hosted={env.AUTH_PROVIDER === "supabase"}
      />
    </section>
  );
}
