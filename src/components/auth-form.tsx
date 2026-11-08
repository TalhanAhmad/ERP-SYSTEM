"use client";
import { MIN_PASSWORD_LENGTH } from "@/lib/auth/password-policy";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { accountAction } from "@/lib/auth/client";
export function LoginForm() {
  const router = useRouter();
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  return (
    <form
      onSubmit={async (event) => {
        event.preventDefault();
        setPending(true);
        setError("");
        try {
          const form = new FormData(event.currentTarget);
          await accountAction("sign-in", {
            email: String(form.get("email")).toLowerCase().trim(),
            password: String(form.get("password")),
          });
          router.push("/dashboard");
          router.refresh();
        } catch (error) {
          setError(
            error instanceof Error
              ? error.message
              : "Unable to connect. Try again.",
          );
        } finally {
          setPending(false);
        }
      }}
    >
      <label>
        Work email
        <input
          name="email"
          type="email"
          autoComplete="username"
          placeholder="you@company.com"
          required
        />
      </label>
      <label>
        Password
        <input
          name="password"
          type="password"
          autoComplete="current-password"
          required
          minLength={MIN_PASSWORD_LENGTH}
        />
      </label>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <button className="primary" disabled={pending}>
        {pending ? "Signing in…" : "Sign in to workspace →"}
      </button>
      <p className="note">
        <Link href="/forgot-password">Forgot your password?</Link>
      </p>
      <p className="note">
        Access is by invitation only. Contact your administrator if you need an
        account.
      </p>
    </form>
  );
}
export function Logout() {
  const router = useRouter();
  return (
    <button
      onClick={async () => {
        await accountAction("sign-out", {});
        router.push("/login");
        router.refresh();
      }}
    >
      Sign out
    </button>
  );
}
export function AcceptForm({ token }: { token: string }) {
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const [done, setDone] = useState(false);
  return done ? (
    <div className="success">
      Account created. <Link href="/login">Sign in to continue →</Link>
    </div>
  ) : (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        setPending(true);
        setError("");
        const form = new FormData(e.currentTarget);
        try {
          const r = await fetch("/api/v1/invitations/accept", {
            method: "POST",
            headers: {
              "content-type": "application/json",
              "x-encova-csrf": "1",
            },
            body: JSON.stringify({
              token,
              email: form.get("email"),
              password: form.get("password"),
            }),
          });
          const data = await r.json();
          if (!r.ok) throw new Error(data.error.message);
          setDone(true);
        } catch (err) {
          setError(
            err instanceof Error ? err.message : "Unable to accept invitation.",
          );
        } finally {
          setPending(false);
        }
      }}
    >
      <label>
        Invited email
        <input name="email" type="email" autoComplete="username" required />
      </label>
      <label>
        Choose a password
        <input
          name="password"
          type="password"
          autoComplete="new-password"
          minLength={MIN_PASSWORD_LENGTH}
          maxLength={128}
          required
        />
      </label>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <button className="primary" disabled={pending}>
        {pending ? "Creating account…" : "Accept invitation"}
      </button>
    </form>
  );
}
