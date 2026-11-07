import Link from "next/link";
import { ResetForm } from "@/components/reset-form";
export default async function Reset({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;
  return (
    <main className="auth-form">
      <h1>Choose a new password.</h1>
      {token ? (
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
