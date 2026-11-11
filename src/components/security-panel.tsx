"use client";
import { useState, useSyncExternalStore, useTransition } from "react";
import { useRouter } from "next/navigation";
const subscribe = () => () => {};
export function SecurityPanel({
  factors,
  level,
  admin,
  required,
  version,
  emailChangesAvailable,
  pendingEmail,
}: {
  factors: { id: string; status: string }[];
  level: string;
  admin: boolean;
  required: boolean;
  version: number;
  emailChangesAvailable: boolean;
  pendingEmail: string;
}) {
  const ready = useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
  const [refreshing, startTransition] = useTransition();
  const router = useRouter(),
    [enrollment, setEnrollment] = useState<{
      id: string;
      secret: string;
      qrCode: string;
    } | null>(null),
    [pending, setPending] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState("");
  async function action(input: Record<string, unknown>) {
    setPending(true);
    setError("");
    setMessage("");
    try {
      const r = await fetch("/api/security", {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-Encova-CSRF": "1" },
          body: JSON.stringify(input),
        }),
        j = await r.json();
      if (!r.ok)
        throw new Error(j.error?.message ?? "Unable to update security.");
      if (input.action === "enroll") setEnrollment(j.data);
      else if (input.action === "sign-out-all") {
        router.push("/login");
        router.refresh();
      } else {
        setEnrollment(null);
        setMessage(
          input.action === "email-change"
            ? "Confirm the change from both your current and new email inboxes. Your login email stays unchanged until confirmation completes."
            : "Account security updated.",
        );
        startTransition(() => router.refresh());
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to update security.");
    } finally {
      setPending(false);
    }
  }
  const factor = enrollment ?? factors[0];
  return (
    <section className="panel">
      <h2>Authenticator</h2>
      <p>
        {level === "aal2"
          ? "This session is verified with your authenticator."
          : "Verify a six-digit authenticator code to unlock an enrolled account."}
      </p>
      <fieldset
        className="mutation-fields"
        disabled={!ready || pending || refreshing}
      >
        {!factor && (
          <button
            className="primary"
            onClick={() => action({ action: "enroll" })}
          >
            Set up authenticator
          </button>
        )}
        {enrollment && (
          <div>
            <p>
              Add Encova to your authenticator using this setup key. Keep it
              private.
            </p>
            <code className="preline">{enrollment.secret}</code>
            {enrollment.qrCode.startsWith("data:image/svg+xml") && (
              // The one-time provider QR must never pass through an image cache.
              // eslint-disable-next-line @next/next/no-img-element
              <img
                className="authenticator-qr"
                alt="Scan to add Encova to your authenticator"
                src={enrollment.qrCode}
              />
            )}
          </div>
        )}
        {factor && (
          <>
            <form
              method="post"
              onSubmit={(e) => {
                e.preventDefault();
                action({
                  action: "verify",
                  factorId: factor.id,
                  code: new FormData(e.currentTarget).get("code"),
                });
              }}
            >
              <label>
                Authenticator code
                <input
                  name="code"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  required
                  pattern="[0-9]{6}"
                  maxLength={6}
                />
              </label>
              <button className="primary">Verify authenticator</button>
            </form>
            <form
              method="post"
              onSubmit={(e) => {
                e.preventDefault();
                action({ action: "remove", factorId: factor.id });
              }}
            >
              <label className="file-choice">
                <input type="checkbox" required />
                Confirm removing this authenticator
              </label>
              <button>Remove authenticator</button>
            </form>
          </>
        )}
        {admin && (
          <form
            method="post"
            onSubmit={(e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              action({
                action: "policy",
                expectedVersion: version,
                required: f.get("required") === "on",
              });
            }}
          >
            <h2>Privileged account policy</h2>
            <p>
              Requires an authenticator for Super Admin, HR and Team Lead
              access. Other accounts keep their own enrollment choice. Verify
              your own authenticator before changing this setting.
            </p>
            <label className="file-choice">
              <input
                type="checkbox"
                name="required"
                defaultChecked={required}
              />
              Require privileged authenticators
            </label>
            <button>Save authenticator policy</button>
          </form>
        )}
        <h2>Login email</h2>
        {pendingEmail && (
          <p>
            Waiting for confirmation: {pendingEmail}. Confirm both inboxes, then
            sign in with the new address.
          </p>
        )}
        {!emailChangesAvailable ? (
          <p>
            Email delivery must be configured before login email changes are
            available.
          </p>
        ) : (
          <form
            method="post"
            onSubmit={async (e) => {
              e.preventDefault();
              const form = e.currentTarget,
                fields = new FormData(form);
              await action({
                action: "email-change",
                email: fields.get("email"),
                password: fields.get("password"),
              });
              const password = form.elements.namedItem("password");
              if (password instanceof HTMLInputElement) password.value = "";
            }}
          >
            <p>
              Confirmation is required from both email addresses. Your work and
              history stay with this account.
            </p>
            <label>
              New login email
              <input
                name="email"
                type="email"
                maxLength={254}
                required
                autoComplete="email"
              />
            </label>
            <label>
              Current password
              <input
                name="password"
                type="password"
                required
                autoComplete="current-password"
                maxLength={128}
              />
            </label>
            <button>Send confirmation emails</button>
          </form>
        )}
        <form
          method="post"
          onSubmit={(e) => {
            e.preventDefault();
            action({ action: "sign-out-all" });
          }}
        >
          <h2>Sessions</h2>
          <p>
            Sign out all devices, including this one. Your password remains
            unchanged.
          </p>
          <label className="file-choice">
            <input type="checkbox" required />
            Confirm signing out all devices
          </label>
          <button>Sign out all devices</button>
        </form>
      </fieldset>
      {pending && <p role="status">Updating account security…</p>}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {message && (
        <p className="success" role="status">
          {message}
        </p>
      )}
    </section>
  );
}
