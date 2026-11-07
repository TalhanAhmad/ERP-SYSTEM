import Link from "next/link";
export default function NotFound() {
  return (
    <main className="content">
      <h1>Page not found.</h1>
      <p className="muted">
        This page is unavailable or you do not have access to it.
      </p>
      <Link className="button" href="/dashboard">
        Return to workspace
      </Link>
    </main>
  );
}
