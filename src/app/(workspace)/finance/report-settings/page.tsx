import Link from "next/link";
import { z } from "zod";
import { financePageData } from "@/modules/finance/accounting/page-data";
import {
  statementSettings,
  statementTaxMapping,
} from "@/modules/finance/reports/statements/service";
import { statementSettingsQuerySchema } from "@/modules/finance/reports/statements/schemas";
import {
  StatementPolicyForm,
  StatementTaxMappingForm,
} from "@/modules/finance/components/statement-setting-forms";
import { FinanceNavigation } from "@/modules/finance/components/setup-navigation";
import { env } from "@/server/env";
export const dynamic = "force-dynamic";
export default async function Settings({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { accountId, ...raw } = await searchParams,
    q = statementSettingsQuerySchema.safeParse(raw),
    id = z.uuid().safeParse(accountId),
    d = await financePageData(async (a) => ({
      settings: await statementSettings(a, q.success ? q.data : {}),
      editing: id.success ? await statementTaxMapping(a, id.data) : null,
    })),
    s = d.settings,
    m = d.editing?.item,
    initial = m
      ? { id: m.accountId, code: m.account.code, name: m.account.name }
      : undefined,
    hosted = env.AUTH_PROVIDER === "supabase";
  return (
    <section>
      <FinanceNavigation />
      <h1>Statement presentation</h1>
      <p>
        Presentation settings classify actual posted balances without adding
        income, expense or cash. Current selected administrators can read them;
        the current Finance Owner records changes with fresh verification.
      </p>
      <section className="panel">
        <h2>Bank credit balances</h2>
        <p>
          Current presentation:{" "}
          {s.policy?.overdraftPresentation === "CURRENT_LIABILITY"
            ? "current liabilities (reviewed)"
            : "unreviewed"}{" "}
          · version {s.policy?.version ?? "not configured"}
        </p>
        {s.policy && (
          <p>
            {s.policy.evidence} · {s.policy.updatedBy} · {s.policy.updatedAt}
          </p>
        )}
        {s.isOwner && (
          <StatementPolicyForm
            key={s.policy?.version ?? "new"}
            hosted={hosted}
            policy={s.policy}
          />
        )}
      </section>
      {s.isOwner && (
        <section className="panel" aria-label="Income-tax expense presentation">
          <h2>Income-tax expense classification</h2>
          <StatementTaxMappingForm
            key={initial?.id ?? "new"}
            hosted={hosted}
            initialAccount={initial}
          />
        </section>
      )}
      <section className="panel">
        <h2>Retained income-tax mappings</h2>
        <form method="get" className="form-grid">
          <label>
            Search tax mappings
            <input
              name="q"
              maxLength={100}
              defaultValue={q.success ? q.data.q : ""}
            />
          </label>
          <button type="submit">Filter tax mappings</button>
        </form>
        <p>
          {s.total} matching mappings · Page {s.page} of {s.pages}
        </p>
        <div
          className="table-wrap"
          role="region"
          aria-label="Income-tax mappings"
          tabIndex={0}
        >
          <table>
            <thead>
              <tr>
                <th scope="col">Expense account</th>
                <th scope="col">Presentation</th>
                <th scope="col">Version / evidence</th>
              </tr>
            </thead>
            <tbody>
              {s.items.map((m) => (
                <tr key={m.id}>
                  <td>
                    {s.isOwner ? (
                      <Link href={"?accountId=" + m.accountId}>
                        {m.code} · {m.name}
                      </Link>
                    ) : (
                      m.code + " · " + m.name
                    )}
                    {m.accountActive ? "" : " (archived)"}
                  </td>
                  <td>
                    {m.active
                      ? "Income-tax expense"
                      : "Ordinary expense presentation"}
                  </td>
                  <td>
                    {m.version} · {m.evidence} · {m.updatedBy}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!s.total && <p>No income-tax mappings match this display filter.</p>}
        <div className="form-actions">
          {s.page > 1 && (
            <Link
              href={
                "?" +
                new URLSearchParams({
                  q: q.success ? q.data.q : "",
                  page: String(s.page - 1),
                })
              }
            >
              Previous tax mappings
            </Link>
          )}
          {s.page < s.pages && (
            <Link
              href={
                "?" +
                new URLSearchParams({
                  q: q.success ? q.data.q : "",
                  page: String(s.page + 1),
                })
              }
            >
              Next tax mappings
            </Link>
          )}
        </div>
      </section>
      <section className="panel">
        <h2>Presentation history</h2>
        <ol>
          {s.history.map((e) => (
            <li key={e.id}>
              {e.action} · {e.actor} · {e.createdAt} · {e.reason}
            </li>
          ))}
        </ol>
      </section>
    </section>
  );
}
