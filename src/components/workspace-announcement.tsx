"use client";
import { useEffect, useState } from "react";
export type AnnouncementView = {
  id: string;
  title: string;
  body: string;
  version: number;
  publishedAt: string;
  expiresAt: string;
};
export function WorkspaceAnnouncement({
  initial,
}: {
  initial: AnnouncementView | null;
}) {
  const [item, setItem] = useState(initial);
  useEffect(() => {
    const controller = new AbortController();
    const refresh = async () => {
      if (document.hidden) return;
      try {
        const response = await fetch("/api/v1/announcements", {
          cache: "no-store",
          signal: controller.signal,
        });
        if (response.ok) {
          const json = await response.json();
          setItem(json.data);
        } else if (response.status === 401 || response.status === 403)
          setItem(null);
      } catch {
        /* Keep a valid message during a temporary connection failure. Its expiry timer still runs. */
      }
    };
    const timer = setInterval(refresh, 20000);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      controller.abort();
      clearInterval(timer);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, []);
  useEffect(() => {
    if (!item) return;
    const timer = setTimeout(
      () => setItem(null),
      Math.max(0, Date.parse(item.expiresAt) - Date.now()),
    );
    return () => clearTimeout(timer);
  }, [item]);
  if (!item) return null;
  return (
    <section
      className="workspace-announcement"
      aria-label="Company announcement"
      aria-live="polite"
    >
      <span className="eyebrow">ANNOUNCEMENT · FROM ADMIN</span>
      <h2>{item.title}</h2>
      <p className="preline">{item.body}</p>
      <small>
        Visible until{" "}
        {new Intl.DateTimeFormat("en-GB", {
          timeZone: "Asia/Karachi",
          day: "numeric",
          month: "short",
          hour: "2-digit",
          minute: "2-digit",
        }).format(new Date(item.expiresAt))}{" "}
        · Karachi
      </small>
    </section>
  );
}
