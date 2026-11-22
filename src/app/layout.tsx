import type { Metadata } from "next";
import "./globals.css";
import { env } from "@/server/env";
export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Encova Workspace",
  description: "Your people, projects, and progress in one workspace.",
};
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        {env.FINANCE_DEMO && (
          <aside
            className="finance-demo-banner"
            aria-label="Finance demo notice"
          >
            <strong>Finance demo · synthetic January 2020 records</strong>
            <span>
              Use sample data only. Email and external file storage are not
              connected.
            </span>
          </aside>
        )}
        {children}
      </body>
    </html>
  );
}
