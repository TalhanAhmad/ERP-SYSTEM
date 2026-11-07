import { AcceptForm } from "@/components/auth-form";
export default async function Invite({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  return (
    <main className="auth-form">
      <span className="eyebrow">ENCOVA WORKSPACE</span>
      <h1>You’re invited.</h1>
      <p className="muted">
        Use the email that received this invitation and create your password.
        Invitations expire after 72 hours.
      </p>
      <AcceptForm token={token} />
    </main>
  );
}
