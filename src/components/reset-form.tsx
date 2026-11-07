"use client";
import { useState } from "react";
import Link from "next/link";
import { createAuthClient } from "better-auth/react";
const auth = createAuthClient();
export function ResetForm({ token }: { token?: string }) {
  const [done, setDone] = useState(false),
    [pending, setPending] = useState(false),
    [error, setError] = useState("");
  return done ? (
    <div className="success">
      {token
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
          if (token) {
            const result = await auth.resetPassword({
              token,
              newPassword: String(form.get("password")),
            });
            if (result.error)
              throw new Error(
                "This reset link is invalid or expired. Request a new one.",
              );
          } else
            await auth.requestPasswordReset({
              email: String(form.get("email")).toLowerCase().trim(),
              redirectTo: `${window.location.origin}/reset-password`,
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
      {token ? (
        <label>
          New password
          <input
            name="password"
            type="password"
            autoComplete="new-password"
            required
            minLength={12}
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
          : token
            ? "Set new password"
            : "Request reset instructions"}
      </button>
    </form>
  );
}
