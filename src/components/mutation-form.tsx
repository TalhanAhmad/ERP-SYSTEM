"use client";
import { useSyncExternalStore, useRef, useState } from "react";
import { useRouter } from "next/navigation";
const subscribe = () => () => {};
const clientSnapshot = () => true;
const serverSnapshot = () => false;
export function MutationForm({
  endpoint,
  children,
  transform,
  label = "Save",
  method = "POST",
  successMessage = "Saved successfully.",
  redirectTo,
}: {
  endpoint: string;
  children?: React.ReactNode;
  transform?: (data: FormData) => unknown;
  label?: string;
  method?: "POST" | "PATCH";
  successMessage?: string;
  redirectTo?: string;
}) {
  const router = useRouter();
  const ready = useSyncExternalStore(subscribe, clientSnapshot, serverSnapshot);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);
  const [pending, setPending] = useState(false);
  const retry = useRef<{ body: string; key: string } | null>(null);
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        const form = e.currentTarget;
        setPending(true);
        setError("");
        setSuccess(false);
        try {
          const fields = new FormData(form);
          const body = JSON.stringify(
            transform
              ? transform(fields)
              : Object.fromEntries(fields.entries()),
          );
          // Preserve the key after a network failure; a deliberate input change gets a new key.
          if (retry.current?.body !== body)
            retry.current = { body, key: crypto.randomUUID() };
          const response = await fetch(endpoint, {
            method,
            headers: {
              "content-type": "application/json",
              "x-encova-csrf": "1",
              "idempotency-key": retry.current.key,
            },
            body,
          });
          const data = await response.json();
          if (!response.ok) {
            retry.current = null;
            throw new Error(
              data.error.fields
                ? [
                    data.error.message,
                    ...Object.entries(data.error.fields.fieldErrors ?? {}).map(
                      ([field, messages]) =>
                        `${field}: ${(messages as string[]).join(" ")}`,
                    ),
                    ...(data.error.fields.formErrors ?? []),
                  ].join(" ")
                : data.error.message,
            );
          }
          retry.current = null;
          setSuccess(true);
          form.reset();
          if (redirectTo) router.push(redirectTo);
          router.refresh();
        } catch (err) {
          setError(err instanceof Error ? err.message : "Unable to save.");
        } finally {
          setPending(false);
        }
      }}
    >
      <fieldset className="mutation-fields" disabled={!ready || pending}>
        {children}
        {error && (
          <div className="error" role="alert">
            {error}
            {error.includes("Reload") && (
              <button type="button" onClick={() => router.refresh()}>
                Reload record
              </button>
            )}
          </div>
        )}
        {success && (
          <div className="success" role="status">
            {successMessage}
          </div>
        )}
        <div className="form-actions">
          <button className="primary" disabled={pending}>
            {pending ? "Saving…" : label}
          </button>
        </div>
      </fieldset>
    </form>
  );
}
