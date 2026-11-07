import { LoginForm } from "@/components/auth-form";
export default function Login() {
  return (
    <main className="auth-page">
      <section className="auth-art">
        <div className="brand">
          <span className="brand-icon">e</span>encova
          <span style={{ fontWeight: 400 }}>workspace</span>
        </div>
        <div>
          <span className="eyebrow" style={{ color: "#acc5a9" }}>
            A LITTLE CLARITY. A LOT OF PROGRESS.
          </span>
          <h1>Good work starts with a shared space.</h1>
          <p>
            Your team, your projects, and the next step forward. Welcome to a
            more connected workday.
          </p>
        </div>
        <small>ENCOVA SOLUTIONS · INTERNAL WORKSPACE</small>
      </section>
      <section className="auth-form">
        <span className="eyebrow">WELCOME BACK</span>
        <h1>Let’s get to work.</h1>
        <p className="muted">Sign in with your company account.</p>
        <LoginForm />
      </section>
    </main>
  );
}
