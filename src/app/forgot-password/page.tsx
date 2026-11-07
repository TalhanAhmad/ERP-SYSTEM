import { ResetForm } from "@/components/reset-form";
export default function Forgot() {
  return (
    <main className="auth-form">
      <span className="eyebrow">ACCOUNT ACCESS</span>
      <h1>Reset your password.</h1>
      <p className="muted">
        We’ll send instructions if an eligible account exists.
      </p>
      <ResetForm />
    </main>
  );
}
