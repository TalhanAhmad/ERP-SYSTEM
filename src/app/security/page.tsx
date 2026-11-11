import { loginEmailAvailable } from "@/server/login-email";
import Link from "next/link";
import { redirect } from "next/navigation";
import { context } from "@/server/context";
import { env } from "@/server/env";
import { supabaseServer } from "@/server/supabase/client";
import { companySettings } from "@/modules/settings/service";
import { SecurityPanel } from "@/components/security-panel";
export const dynamic = "force-dynamic";
export default async function SecurityPage() {
  const actor = await context(undefined, { allowSecurity: true }).catch(() =>
    redirect("/login"),
  );
  const settings = await companySettings();
  let factors: { id: string; status: string }[] = [],
    level = "aal1",
    pendingEmail = "";
  if (env.AUTH_PROVIDER === "supabase") {
    const client = await supabaseServer(),
      { data } = await client.auth.getUser();
    pendingEmail = data.user?.new_email ?? "";
    factors = (data.user?.factors ?? [])
      .filter((f) => f.factor_type === "totp")
      .map((f) => ({ id: f.id, status: f.status }));
    level =
      (await client.auth.mfa.getAuthenticatorAssuranceLevel()).data
        ?.currentLevel ?? "aal1";
  }
  return (
    <main className="content security-content">
      <Link href="/dashboard">← Workspace</Link>
      <h1>Account security</h1>
      <p>
        {actor.displayName} · {actor.email}
      </p>
      {env.AUTH_PROVIDER === "supabase" ? (
        <SecurityPanel
          factors={factors}
          level={level}
          admin={actor.role === "SUPER_ADMIN"}
          required={settings.requirePrivilegedMfa}
          version={settings.version}
          emailChangesAvailable={loginEmailAvailable()}
          pendingEmail={pendingEmail}
        />
      ) : (
        <p>
          Authenticator enrollment is available on the live Supabase deployment.
        </p>
      )}
    </main>
  );
}
