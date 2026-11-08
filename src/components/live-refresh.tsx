"use client";
import { useEffect, useTransition } from "react";
import { useRouter } from "next/navigation";
export function LiveRefresh() {
  const router = useRouter();
  const [pending, start] = useTransition();
  useEffect(() => {
    const refresh = () => {
      if (!document.hidden) router.refresh();
    };
    const timer = setInterval(refresh, 30000);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [router]);
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => start(() => router.refresh())}
    >
      {pending ? "Refreshing…" : "Refresh attendance"}
    </button>
  );
}
