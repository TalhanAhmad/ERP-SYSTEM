import Link from "next/link";
import { env } from "@/server/env";
import { financePageData } from "@/modules/finance/accounting/page-data";
import { taxCodes } from "@/modules/finance/taxes/service";
import { taxQuerySchema } from "@/modules/finance/taxes/schemas";
import { FinanceNavigation } from "@/modules/finance/components/setup-navigation";
import {
  TaxCodeForm,
  RetireTaxCode,
} from "@/modules/finance/components/tax-forms";
export const dynamic = "force-dynamic";
export default async function TaxPolicies({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const raw = await searchParams,
    data = await financePageData((a) => {
      const p = taxQuerySchema.safeParse(raw);
      return taxCodes(a, p.success ? p.data : {});
    }),
    hosted = env.AUTH_PROVIDER === "supabase";
  return (
    <section>
      <FinanceNavigation />
      <h1>Tax policies</h1>
      <p>
        Optional company-reviewed tax and withholding codes. No tax applies
        until a code is explicitly selected. Posted documents preserve their
        actual policy snapshot.
      </p>
      <form method="get" className="form-grid">
        <label>
          Search policies
          <input name="q" defaultValue={data.filters.q} />
        </label>
        <label>
          Policy status
          <select name="active" defaultValue={data.filters.active}>
            {["ACTIVE", "ALL", "RETIRED"].map((v) => (
              <option key={v}>{v}</option>
            ))}
          </select>
        </label>
        <button>Apply policy filters</button>
      </form>
      <p>
        {data.total} policies · page {data.page} of {data.pages}
      </p>
      {data.items.map((i) => (
        <section className="panel" key={i.id}>
          <h2>
            {i.code} · {i.name}
          </h2>
          <p>
            {i.kind} · {i.rate}% · {i.mode} · {i.rounding} ·{" "}
            {i.active ? "Active" : "Retired"}
          </p>
          <p>
            {i.effectiveFrom} to {i.effectiveTo ?? "open end"}
          </p>
          <p>
            Input {i.inputAccount.code} · Output {i.outputAccount.code}
          </p>
          <p>{i.policyEvidence}</p>
          {data.isOwner && i.active && (
            <RetireTaxCode id={i.id} hosted={hosted} />
          )}
        </section>
      ))}
      <div className="form-actions">
        {data.page > 1 && (
          <Link
            href={
              "?" +
              new URLSearchParams({
                ...data.filters,
                page: String(data.page - 1),
              })
            }
          >
            Previous policies
          </Link>
        )}
        {data.page < data.pages && (
          <Link
            href={
              "?" +
              new URLSearchParams({
                ...data.filters,
                page: String(data.page + 1),
              })
            }
          >
            Next policies
          </Link>
        )}
      </div>
      {data.isOwner && (
        <section className="panel">
          <h2>Create a reviewed policy</h2>
          <TaxCodeForm hosted={hosted} />
        </section>
      )}
    </section>
  );
}
