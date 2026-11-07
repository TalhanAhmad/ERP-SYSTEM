"use client";
export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <main className="content">
      <h1>We couldn’t load this page.</h1>
      <p className="muted">
        Your changes have not been silently discarded. Check your connection and
        try again.
      </p>
      <button onClick={reset}>Try again</button>
    </main>
  );
}
