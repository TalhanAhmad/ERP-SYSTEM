import Link from "next/link";
import { notFound } from "next/navigation";
import { env } from "@/server/env";
import { financePageData } from "../accounting/page-data";
import {
  masters,
  masterDetail,
  masterPeople,
  type MasterResource,
} from "../masters/service";
import { masterQuerySchema, partyKinds } from "../masters/schemas";
import { FinanceRegister } from "./finance-register";
import { FinanceNavigation, SetupHistory } from "./setup-navigation";
import { PartyForm, CashForm, MasterStateForm } from "./master-forms";
export async function MasterListPage({
  resource,
  raw,
}: {
  resource: MasterResource;
  raw: Record<string, string | string[] | undefined>;
}) {
  const { data, invalid } = await financePageData(async (a) => {
    const p = masterQuerySchema.safeParse(raw);
    const validKind =
      p.success &&
      (resource === "parties"
        ? ["ALL", ...partyKinds]
        : ["ALL", "BANK", "CASH"]
      ).includes(p.data.kind);
    return {
      data: await masters(a, resource, validKind ? p.data : {}),
      invalid: !validKind,
    };
  });
  const isParty = resource === "parties",
    label = isParty ? "Party" : "Cash account",
    title = isParty ? "Parties" : "Cash accounts",
    base = "/finance/" + resource;
  const href = (page: number) =>
    base +
    "?" +
    new URLSearchParams(
      Object.fromEntries(
        Object.entries({ ...data.filters, page }).map(([k, v]) => [
          k,
          String(v),
        ]),
      ),
    );
  return (
    <section>
      <FinanceNavigation />
      <h1>{title}</h1>
      <p>
        {isParty
          ? "Retain client, supplier and employee contact profiles for future documents."
          : "Map each bank or cash register to one protected PKR GL account."}
      </p>
      {data.canManage && (
        <Link className="button primary" href={base + "/new"}>
          {isParty ? "New party" : "New cash account"}
        </Link>
      )}
      {invalid && (
        <p role="alert">
          Invalid filters. Showing the default view.{" "}
          <Link href={base}>Clear filters</Link>
        </p>
      )}
      <FinanceRegister
        label={label}
        columns={[
          "Name",
          isParty ? "Legal name" : "GL account",
          "Kind",
          "State",
        ]}
        total={data.total}
        page={data.page}
        pages={data.pages}
        href={href}
        rows={data.items.map((i) => ({
          id: i.id,
          name: i.name,
          href: base + "/" + i.id,
          endpoint: "/api/v1/finance/" + resource + "/" + i.id,
          cells: [
            "legalName" in i
              ? i.legalName
              : "glAccount" in i
                ? i.glAccount.code + " · " + i.glAccount.name
                : "",
            i.kind,
            i.active ? "Active" : "Archived",
          ],
        }))}
      >
        <form method="get" className="form-grid">
          <label>
            Search {title.toLowerCase()}
            <input name="q" defaultValue={data.filters.q} maxLength={100} />
          </label>
          <label>
            {label} state
            <select name="active" defaultValue={data.filters.active}>
              <option value="ACTIVE">Active</option>
              <option value="ARCHIVED">Archived</option>
              <option value="ALL">All</option>
            </select>
          </label>
          <label>
            {label} kind
            <select name="kind" defaultValue={data.filters.kind}>
              {(isParty ? ["ALL", ...partyKinds] : ["ALL", "BANK", "CASH"]).map(
                (k) => (
                  <option key={k}>{k}</option>
                ),
              )}
            </select>
          </label>
          <label>
            Order
            <select name="sort" defaultValue={data.filters.sort}>
              <option value="name">Name</option>
              <option value="updated">Recently changed</option>
            </select>
          </label>
          <label>
            Rows per page
            <select name="pageSize" defaultValue={data.filters.pageSize}>
              {[25, 50, 100].map((n) => (
                <option key={n}>{n}</option>
              ))}
            </select>
          </label>
          <button type="submit">Apply filters</button>
        </form>
      </FinanceRegister>
    </section>
  );
}
export async function NewMasterPage({
  resource,
}: {
  resource: MasterResource;
}) {
  const data = await financePageData((a) => masters(a, resource));
  if (!data.canManage) notFound();
  const hosted = env.AUTH_PROVIDER === "supabase";
  return (
    <section>
      <FinanceNavigation />
      <h1>{resource === "parties" ? "New party" : "New cash account"}</h1>
      <section
        className="panel"
        aria-label={
          resource === "parties" ? "Create party" : "Create cash account"
        }
      >
        {resource === "parties" ? (
          <PartyForm
            people={await financePageData(masterPeople)}
            hosted={hosted}
          />
        ) : (
          <CashForm hosted={hosted} />
        )}
      </section>
    </section>
  );
}
export async function MasterDetailPage({
  resource,
  id,
}: {
  resource: MasterResource;
  id: string;
}) {
  const data = await financePageData((a) => masterDetail(a, resource, id)),
    item = data.item,
    hosted = env.AUTH_PROVIDER === "supabase";
  return (
    <section>
      <FinanceNavigation />
      <h1>{item.name}</h1>
      <p>
        {item.kind} · {item.active ? "Active" : "Archived"}
      </p>
      {data.canManage ? (
        <>
          <section
            className="panel"
            aria-label={
              resource === "parties" ? "Edit party" : "Edit cash account"
            }
          >
            <h2>Edit {resource === "parties" ? "party" : "cash account"}</h2>
            {data.resource === "parties" ? (
              <PartyForm
                key={item.version}
                item={data.item}
                people={await financePageData(masterPeople)}
                hosted={hosted}
              />
            ) : (
              <CashForm key={item.version} item={data.item} hosted={hosted} />
            )}
          </section>
          <section className="panel" aria-label="Archive or reactivate">
            <h2>{item.active ? "Archive" : "Reactivate"}</h2>
            <p>Retain all references and history.</p>
            <MasterStateForm
              key={item.version}
              id={item.id}
              version={item.version}
              active={item.active}
              resource={resource}
              hosted={hosted}
            />
          </section>
        </>
      ) : (
        <section className="panel">
          <h2>Record summary</h2>
          {data.resource === "parties" ? (
            <>
              <p>{data.item.legalName}</p>
              <p>{data.item.contactEmail}</p>
              <p>{data.item.phone}</p>
              <p>{data.item.address}</p>
            </>
          ) : (
            <>
              <p>
                GL:{" "}
                <Link href={"/finance/accounts/" + data.item.glAccountId}>
                  {data.item.glAccount.code} · {data.item.glAccount.name}
                </Link>
              </p>
              <p>
                PKR ·{" "}
                {data.item.maskedReference
                  ? "•••• " + data.item.maskedReference
                  : "No bank reference stored"}
              </p>
            </>
          )}
          <p>The Finance Owner manages this setup.</p>
        </section>
      )}
      <SetupHistory events={data.history} />
    </section>
  );
}
