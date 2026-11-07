import Link from "next/link";
import { env } from "@/server/env";
import { supabaseServer } from "@/server/supabase/client";
import { ResetForm } from "@/components/reset-form";
export default async function Reset({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;
  const hasSupabaseSession =
    env.AUTH_PROVIDER === "supabase" &&
    !!(await (await supabaseServer()).auth.getUser()).data.user;
  return (
    <main className="auth-form">
      <h1>Choose a new password.</h1>
      {hasSupabaseSession ? (
        <ResetForm mode="update" />
      ) : token && env.AUTH_PROVIDER === "better-auth" ? (
        <ResetForm token={token} />
      ) : (
        <p className="error">
          Reset link missing or expired.{" "}
          <Link href="/forgot-password">Request a new link.</Link>
        </p>
      )}
    </main>
  );
}
