"use client";
import { useRef, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import type { financeAccessSnapshot } from "../access/service";
type Snapshot = Awaited<ReturnType<typeof financeAccessSnapshot>>;
const subscribe = () => () => {};
const clientSnapshot = () => true;
const serverSnapshot = () => false;

function AccessForm({
  label,
  endpoint,
  hosted,
  children,
  business,
  disabled = false,
}: {
  label: string;
  endpoint: string;
  hosted: boolean;
  children?: React.ReactNode;
  business: (form: FormData) => Record<string, unknown>;
  disabled?: boolean;
}) {
  const router = useRouter();
  const ready = useSyncExternalStore(subscribe, clientSnapshot, serverSnapshot);
  const [pending, setPending] = useState(false),
    [error, setError] = useState("");
  const retry = useRef<{ business: string; key: string } | null>(null);
  return (
    <form
      method="post"
      onSubmit={async (e) => {
        e.preventDefault();
        const form = e.currentTarget,
          fields = new FormData(form);
        setPending(true);
        setError("");
        try {
          const data = business(fields),
            fingerprint = JSON.stringify(data);
          if (retry.current?.business !== fingerprint)
            retry.current = { business: fingerprint, key: crypto.randomUUID() };
          const reauth = {
            password: String(fields.get("password")),
            ...(hosted ? { code: String(fields.get("code")) } : {}),
          };
          const response = await fetch(endpoint, {
            method: "POST",
            headers: {
              "content-type": "application/json",
              "x-encova-csrf": "1",
              "idempotency-key": retry.current.key,
            },
            body: JSON.stringify({ ...data, reauth }),
          });
          const result = await response.json();
          if (!response.ok) {
            retry.current = null;
            throw new Error(result.error.message);
          }
          retry.current = null;
          router.refresh();
        } catch (error) {
          setError(
            error instanceof Error
              ? error.message
              : "Unable to save. Try again.",
          );
        } finally {
          // Never retain passwords/codes in retry state or saved drafts.
          for (const name of ["password", "code"]) {
            const input = form.elements.namedItem(name);
            if (input instanceof HTMLInputElement) input.value = "";
          }
          setPending(false);
        }
      }}
    >
      <fieldset
        disabled={!ready || disabled || pending}
        className="mutation-fields"
      >
        {children}
        <label>
          Reason
          <input name="reason" minLength={3} maxLength={500} required />
        </label>
        <label>
          Current password
          <input
            type="password"
            name="password"
            autoComplete="current-password"
            required
            maxLength={128}
          />
        </label>
        {hosted && (
          <label>
            Fresh authenticator code
            <input
              name="code"
              autoComplete="one-time-code"
              inputMode="numeric"
              pattern="[0-9]{6}"
              minLength={6}
              maxLength={6}
              required
            />
          </label>
        )}
        {error && (
          <div role="alert" className="error">
            {error}
            <button type="button" onClick={() => router.refresh()}>
              Reload records
            </button>
          </div>
        )}
        <button type="submit" className="primary">
          {pending ? "Verifying…" : label}
        </button>
      </fieldset>
    </form>
  );
}
export function FinanceAccessPanel({
  snapshot,
  hosted,
}: {
  snapshot: Snapshot;
  hosted: boolean;
}) {
  const { settings, canManage, grants, eligible, transfers, actorId } =
    snapshot;
  const [revoke, setRevoke] = useState<string | null>(null);
  const available = eligible.filter(
    (p) => !grants.some((g) => g.userId === p.id),
  );
  const targets = eligible.filter((p) => grants.some((g) => g.userId === p.id));
  const selected = grants.find((g) => g.id === revoke);
  if (!settings)
    return (
      <div className="panel">
        <p>Contact your operator to finish Finance Owner setup.</p>
      </div>
    );
  return (
    <>
      <div className="panel">
        <h2>Finance Owner: {settings.owner.displayName}</h2>
        <p>
          @{settings.owner.username} ·{" "}
          {canManage
            ? "You manage finance access."
            : "You have selected finance access. Only the owner can change grants."}
        </p>
        <p>
          Ownership transfers require the recipient’s acceptance. The current
          owner remains responsible until then.
        </p>
      </div>
      {canManage && (
        <div className="form-grid">
          <section className="panel" aria-label="Grant finance access">
            <h2>Grant finance access</h2>
            {!available.length && (
              <p>No other eligible administrators are awaiting access.</p>
            )}
            <AccessForm
              label="Grant access"
              endpoint="/api/v1/finance/access/grants"
              hosted={hosted}
              disabled={!available.length}
              business={(f) => ({
                targetId: String(f.get("targetId")),
                expectedVersion: settings.version,
                reason: String(f.get("reason")),
              })}
            >
              <label>
                Super Admin
                <select name="targetId" required>
                  {available.map((p) => (
                    <option value={p.id} key={p.id}>
                      {p.displayName} (@{p.username})
                    </option>
                  ))}
                </select>
              </label>
            </AccessForm>
          </section>
          <section className="panel" aria-label="Transfer finance ownership">
            <h2>Transfer ownership</h2>
            <p>
              First grant the recipient finance access. After acceptance, you
              keep selected access until the new owner revokes it.
            </p>
            <AccessForm
              label="Request ownership transfer"
              endpoint="/api/v1/finance/ownership-transfers"
              hosted={hosted}
              disabled={!targets.length || Boolean(transfers.length)}
              business={(f) => ({
                targetId: String(f.get("targetId")),
                expectedVersion: settings.version,
                reason: String(f.get("reason")),
              })}
            >
              <label>
                New owner
                <select name="targetId" required>
                  {targets.map((p) => (
                    <option value={p.id} key={p.id}>
                      {p.displayName} (@{p.username})
                    </option>
                  ))}
                </select>
              </label>
            </AccessForm>
          </section>
        </div>
      )}
      {transfers.map((transfer) => (
        <section
          className="panel"
          aria-label="Pending ownership transfer"
          key={transfer.id}
        >
          <h2>Pending ownership transfer</h2>
          <p>
            Expires{" "}
            {new Intl.DateTimeFormat("en-GB", {
              timeZone: "Asia/Karachi",
              dateStyle: "medium",
              timeStyle: "short",
            }).format(transfer.expiresAt)}{" "}
            Pakistan time.
          </p>
          <AccessForm
            label={
              transfer.targetOwnerId === actorId
                ? "Accept ownership"
                : "Cancel transfer"
            }
            hosted={hosted}
            endpoint={`/api/v1/finance/ownership-transfers/${transfer.id}/${transfer.targetOwnerId === actorId ? "accept" : "cancel"}`}
            business={(f) => ({
              expectedVersion: transfer.version,
              reason: String(f.get("reason")),
            })}
          />
        </section>
      ))}
      <section className="panel" aria-label="Selected finance administrators">
        <h2>{canManage ? "Selected administrators" : "Your finance access"}</h2>
        <div
          className="table-wrap"
          tabIndex={0}
          role="region"
          aria-label="Finance administrator table"
        >
          <table>
            <thead>
              <tr>
                <th scope="col">Person</th>
                <th scope="col">Account</th>
                <th scope="col">Finance access</th>
                {canManage && <th scope="col">Action</th>}
              </tr>
            </thead>
            <tbody>
              {grants.map((grant) => (
                <tr key={grant.id}>
                  <td>
                    {grant.user.displayName}
                    <small>@{grant.user.username}</small>
                  </td>
                  <td>
                    {grant.user.status.toLowerCase()} ·{" "}
                    {grant.user.role.replaceAll("_", " ").toLowerCase()}
                  </td>
                  <td>
                    {grant.userId === settings.ownerId ? "Owner" : "Selected"}
                  </td>
                  {canManage && (
                    <td>
                      {grant.userId !== settings.ownerId && (
                        <button
                          type="button"
                          onClick={() => setRevoke(grant.id)}
                        >
                          Revoke access
                        </button>
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      {canManage && selected && (
        <section className="panel" aria-label="Revoke selected access">
          <h2>Revoke {selected.user.displayName}’s access</h2>
          <p>
            Subsequent finance requests will be denied. Existing downloaded
            information cannot be recalled.
          </p>
          <AccessForm
            label="Confirm revocation"
            endpoint={`/api/v1/finance/access/grants/${selected.id}/revoke`}
            hosted={hosted}
            business={(f) => ({
              expectedVersion: settings.version,
              grantVersion: selected.version,
              reason: String(f.get("reason")),
            })}
          />
          <button type="button" onClick={() => setRevoke(null)}>
            Keep access
          </button>
        </section>
      )}
      <section className="panel" aria-label="Finance access history">
        <h2>Recent finance history</h2>
        <div
          className="table-wrap"
          tabIndex={0}
          role="region"
          aria-label="Finance history table"
        >
          <table>
            <thead>
              <tr>
                <th scope="col">Action</th>
                <th scope="col">Person</th>
                <th scope="col">Reason</th>
                <th scope="col">Time (Pakistan)</th>
              </tr>
            </thead>
            <tbody>
              {snapshot.history.map((event) => (
                <tr key={event.id}>
                  <td>{event.action.toLowerCase().replaceAll("_", " ")}</td>
                  <td>{event.actor.displayName}</td>
                  <td>{event.reason}</td>
                  <td>
                    {new Intl.DateTimeFormat("en-GB", {
                      timeZone: "Asia/Karachi",
                      dateStyle: "medium",
                      timeStyle: "short",
                    }).format(event.createdAt)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
