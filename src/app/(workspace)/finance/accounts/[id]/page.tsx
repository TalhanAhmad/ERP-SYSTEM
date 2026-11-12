import Link from "next/link";
import { env } from "@/server/env";
import { accountDetail } from "@/modules/finance/accounting/service";
import { financePageData } from "@/modules/finance/accounting/page-data";
import {
  AccountForm,
  AccountArchive,
} from "@/modules/finance/components/setup-forms";
import {
  FinanceNavigation,
  SetupHistory,
} from "@/modules/finance/components/setup-navigation";
export const dynamic = "force-dynamic";
export default async function Account({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const data = await financePageData(async (actor) =>
    accountDetail(actor, (await params).id),
  );
  const a = data.item;
  return (
    <section>
      <FinanceNavigation />
      <h1>
        {a.code} · {a.name}
      </h1>
      <p>
        PKR · {a.active ? "Active" : "Archived"} ·{" "}
        {a.isPosting ? "Posting account" : "Group account"}
      </p>
      {a.parentId && (
        <p>
          <Link href={`/finance/accounts/${a.parentId}`}>
            View parent group
          </Link>
        </p>
      )}
      {data.canManage ? (
        <>
          <section className="panel" aria-label="Edit account">
            <h2>Edit account</h2>
            <AccountForm
              key={`${a.version}:${a.mappingLocked}`}
              item={a}
              groups={data.groups}
              hosted={env.AUTH_PROVIDER === "supabase"}
            />
          </section>
          <section className="panel" aria-label="Archive or reactivate account">
            <h2>{a.active ? "Archive account" : "Reactivate account"}</h2>
            <p>
              Account history is retained. Active child accounts must be
              archived first.
            </p>
            <AccountArchive
              key={a.version}
              item={a}
              hosted={env.AUTH_PROVIDER === "supabase"}
            />
          </section>
        </>
      ) : (
        <div className="panel">
          <h2>Account classification</h2>
          <p>
            {a.type} · {a.normalSide} · {a.reportGroup} · {a.controlType}
          </p>
          <p>The Finance Owner manages account setup.</p>
        </div>
      )}
      <SetupHistory events={data.history} />
    </section>
  );
}
