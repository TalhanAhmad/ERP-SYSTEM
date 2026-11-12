"use client";
import { useRef, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
const subscribe = () => () => {};
const clientSnapshot = () => true;
const serverSnapshot = () => false;

export function FinanceActionForm({
  label,
  endpoint,
  hosted,
  children,
  business,
  disabled = false,
  method = "POST",
  redirectPrefix,
}: {
  label: string;
  endpoint: string;
  hosted: boolean;
  children?: React.ReactNode;
  business: (form: FormData) => Record<string, unknown>;
  disabled?: boolean;
  method?: "POST" | "PATCH";
  redirectPrefix?: string;
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
            method,
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
            const fields = result.error.fields?.fieldErrors ?? {};
            throw new Error(
              [
                result.error.message,
                ...Object.entries(fields).map(
                  ([name, messages]) =>
                    `${name}: ${(messages as string[]).join(" ")}`,
                ),
                ...(result.error.fields?.formErrors ?? []),
              ].join(" "),
            );
          }
          retry.current = null;
          if (redirectPrefix) router.push(redirectPrefix + result.data.id);
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
