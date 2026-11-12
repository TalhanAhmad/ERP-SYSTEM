"use client";
import { useEffect, useRef, useState } from "react";
import { MoneyCell } from "./money-cell";
import { JournalForm, type JournalEditable } from "./journal-forms";
type Line = {
  id: string;
  accountId: string;
  projectId: string | null;
  sequence: number;
  description: string;
  debit: string;
  credit: string;
  account: { code: string; name: string };
  project?: { name: string } | null;
};
type Entry = {
  reference: string;
  postingDate: string;
  lines: Line[];
  reversedBy?: Entry | null;
};
type Detail = {
  projects?: { id: string; name: string }[];
  item: Record<string, unknown> & { lines?: Line[]; entry?: Entry | null };
  history: {
    id: string;
    action: string;
    reason: string;
    createdAt: string;
    actor: { displayName: string };
  }[];
};
export function DetailDrawerLink({
  href,
  endpoint,
  children,
  hosted,
}: {
  href: string;
  endpoint: string;
  children: React.ReactNode;
  hosted: boolean;
}) {
  const dialog = useRef<HTMLDialogElement>(null),
    anchor = useRef<HTMLAnchorElement>(null),
    title = useRef<HTMLHeadingElement>(null),
    abort = useRef<AbortController | null>(null);
  const [data, setData] = useState<Detail | null>(null),
    [error, setError] = useState(""),
    [pending, setPending] = useState(false),
    [section, setSection] = useState("Summary");
  const load = async () => {
    abort.current?.abort();
    const controller = new AbortController();
    abort.current = controller;
    setPending(true);
    setData(null);
    setError("");
    try {
      const response = await fetch(endpoint, {
        signal: controller.signal,
        cache: "no-store",
      });
      const json = await response.json();
      if (!response.ok) throw new Error(json.error.message);
      if (!controller.signal.aborted) setData(json.data);
    } catch (e) {
      if (!controller.signal.aborted)
        setError(
          e instanceof Error ? e.message : "Unable to load this record.",
        );
    } finally {
      if (!controller.signal.aborted) setPending(false);
    }
  };
  useEffect(() => () => abort.current?.abort(), []);
  const r = data?.item;
  const editable: JournalEditable | null =
    r?.state === "DRAFT" &&
    r.lines &&
    typeof r.id === "string" &&
    typeof r.reference === "string" &&
    typeof r.description === "string" &&
    typeof r.evidence === "string" &&
    typeof r.postingDate === "string" &&
    typeof r.version === "number"
      ? {
          id: r.id,
          reference: r.reference,
          description: r.description,
          evidence: r.evidence,
          postingDate: new Date(r.postingDate),
          version: r.version,
          lines: r.lines,
        }
      : null;
  const lines = (rows: Line[]) => (
    <div
      className="table-wrap"
      role="region"
      aria-label="Detail lines table"
      tabIndex={0}
    >
      <table>
        <thead>
          <tr>
            <th scope="col">Account</th>
            <th scope="col">Description / project</th>
            <th scope="col">Debit</th>
            <th scope="col">Credit</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((l) => (
            <tr key={l.sequence}>
              <td>
                {l.account.code} · {l.account.name}
              </td>
              <td>
                {l.description}
                {l.project && <small> · {l.project.name}</small>}
              </td>
              <td>
                <MoneyCell value={l.debit} />
              </td>
              <td>
                <MoneyCell value={l.credit} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
  const summaryKeys: Record<string, string> = {
    reference: "Reference",
    name: "Name",
    legalName: "Legal name",
    kind: "Kind",
    state: "State",
    description: "Description",
    evidence: "Supporting evidence reference",
    postingDate: "Posting date",
    startDate: "Start date (inclusive)",
    endDate: "End date (inclusive)",
    currency: "Currency",
    code: "Code",
    type: "Type",
    normalSide: "Normal side",
    reportGroup: "Report group",
    controlType: "Control",
    maskedReference: "Last four digits",
    contactEmail: "Email",
    phone: "Phone",
    address: "Address",
  };
  return (
    <>
      <a
        ref={anchor}
        href={href}
        onClick={(e) => {
          if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
          e.preventDefault();
          setSection("Summary");
          dialog.current?.showModal();
          title.current?.focus();
          void load();
        }}
      >
        {children}
      </a>
      <dialog
        ref={dialog}
        className="finance-drawer"
        aria-labelledby={href.replaceAll("/", "-") + "-title"}
        onClose={() => {
          abort.current?.abort();
          setData(null);
          anchor.current?.focus();
        }}
      >
        <div className="form-actions">
          <h2
            ref={title}
            tabIndex={-1}
            id={href.replaceAll("/", "-") + "-title"}
          >
            Record details
          </h2>
          <button type="button" onClick={() => dialog.current?.close()}>
            Close details
          </button>
        </div>
        <a href={href}>Open full record</a>
        {pending && <p role="status">Loading current record…</p>}
        {error && (
          <div role="alert">
            <p>{error}</p>
            <button type="button" onClick={() => void load()}>
              Retry details
            </button>
          </div>
        )}
        {data && (
          <>
            <nav aria-label="Detail sections" className="form-actions">
              {[
                "Summary",
                ...(editable ? ["Edit draft"] : []),
                ...(data.item.lines ? ["Lines"] : []),
                ...(data.item.entry ? ["Journal"] : []),
                "History",
              ].map((s) => (
                <button
                  key={s}
                  type="button"
                  aria-pressed={section === s}
                  onClick={() => setSection(s)}
                >
                  {s}
                </button>
              ))}
            </nav>
            <h3>{section}</h3>
            {section === "Edit draft" && editable && (
              <section aria-label="Edit journal draft">
                <JournalForm
                  key={editable.version}
                  item={editable}
                  projects={data.projects ?? []}
                  hosted={hosted}
                  onSaved={() => {
                    setSection("Summary");
                    void load();
                  }}
                />
              </section>
            )}
            {section === "Summary" && (
              <dl>
                {Object.entries(summaryKeys).map(([key, label]) => {
                  const value = data.item[key];
                  return typeof value === "string" && value ? (
                    <div key={key}>
                      <dt>{label}</dt>
                      <dd>{value}</dd>
                    </div>
                  ) : null;
                })}
                {typeof data.item.active === "boolean" && (
                  <div>
                    <dt>Active</dt>
                    <dd>{data.item.active ? "Yes" : "No"}</dd>
                  </div>
                )}
              </dl>
            )}
            {section === "Lines" && data.item.lines && lines(data.item.lines)}
            {section === "Journal" && data.item.entry && (
              <>
                <p>
                  {data.item.entry.reference} ·{" "}
                  {data.item.entry.postingDate.slice(0, 10)}
                </p>
                {lines(data.item.entry.lines)}
                {data.item.entry.reversedBy && (
                  <>
                    <h4>Dated reversal</h4>
                    <p>
                      {data.item.entry.reversedBy.reference} ·{" "}
                      {data.item.entry.reversedBy.postingDate.slice(0, 10)}
                    </p>
                    {lines(data.item.entry.reversedBy.lines)}
                  </>
                )}
              </>
            )}
            {section === "History" && (
              <ul>
                {data.history.map((h) => (
                  <li key={h.id}>
                    {h.action.replaceAll("_", " ").toLowerCase()} ·{" "}
                    {h.actor.displayName} ·{" "}
                    {new Intl.DateTimeFormat("en-GB", {
                      timeZone: "Asia/Karachi",
                      dateStyle: "medium",
                      timeStyle: "short",
                    }).format(new Date(h.createdAt))}
                    <p>{h.reason}</p>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </dialog>
    </>
  );
}
