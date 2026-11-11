import Link from "next/link";
export default async function EmailChangePage({
  searchParams,
}: {
  searchParams: Promise<{ state?: string }>;
}) {
  const state = (await searchParams).state;
  return (
    <main className="content security-content">
      <section className="panel">
        <h1>Login email confirmation</h1>
        <p>
          {state === "complete"
            ? "Your confirmation was accepted. Sign in with your confirmed email address."
            : state === "failed"
              ? "This confirmation could not be completed. Sign in and request fresh confirmation emails."
              : "Confirm the change from both your current and new inboxes. Your existing email remains your login until both confirmations are complete."}
        </p>
        <Link className="button primary" href="/login">
          Sign in
        </Link>
        <Link className="button" href="/security">
          Account security
        </Link>
      </section>
    </main>
  );
}
