"use client";
import { MIN_PASSWORD_LENGTH } from "@/lib/auth/password-policy";
import { useState } from "react";
import Link from "next/link";
import { accountAction } from "@/lib/auth/client";
export function ResetForm({
  token,
  mode = "request",
}: {
  token?: string;
  mode?: "request" | "update";
}) {
  const updating = !!token || mode === "update";
  const [done, setDone] = useState(false),
    [pending, setPending] = useState(false),
    [error, setError] = useState("");
  return done ? (
    <div className="success">
      {updating
        ? "Your password was reset."
        : "If an eligible account exists, password-reset instructions will be emailed."}{" "}
      <Link href="/login">Return to sign in</Link>
    </div>
  ) : (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        const form = new FormData(e.currentTarget);
        setPending(true);
        setError("");
        try {
          if (updating) {
            await accountAction("password-update", {
              password: String(form.get("password")),
              ...(token ? { token } : {}),
            });
          } else
            await accountAction("password-reset", {
              email: String(form.get("email")).toLowerCase().trim(),
            });
          setDone(true);
        } catch (err) {
          setError(
            err instanceof Error
              ? err.message
              : "Unable to connect. Try again.",
          );
        } finally {
          setPending(false);
        }
      }}
    >
      {updating ? (
        <label>
          New password
          <input
            name="password"
            type="password"
            autoComplete="new-password"
            required
            minLength={MIN_PASSWORD_LENGTH}
            maxLength={128}
          />
        </label>
      ) : (
        <label>
          Work email
          <input name="email" type="email" autoComplete="email" required />
        </label>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <button className="primary" disabled={pending}>
        {pending
          ? "Please wait…"
          : updating
            ? "Set new password"
            : "Request reset instructions"}
      </button>
    </form>
  );
}
