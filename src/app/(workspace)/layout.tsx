import Link from "next/link";
import { redirect } from "next/navigation";
import {
  LayoutDashboard,
  FolderKanban,
  CheckSquare,
  Users,
  Bell,
  Shield,
  ArrowUpRight,
} from "lucide-react";
import { context } from "@/server/context";
import { AppError } from "@/server/errors";
import { Logout } from "@/components/auth-form";
export const dynamic = "force-dynamic";
export default async function Workspace({
  children,
}: {
  children: React.ReactNode;
}) {
  const person = await context().catch((error) => {
    if (error instanceof AppError) redirect("/login");
    throw error;
  });
  const items = [
    ["dashboard", "Overview", LayoutDashboard],
    ["projects", "Projects", FolderKanban],
    ["tasks", "My work", CheckSquare],
    ["people", "People", Users],
    ["attendance", "Attendance", CheckSquare],
    ["reports", "Daily reports", CheckSquare],
    ["leave", "Leave", FolderKanban],
    ["corrections", "Corrections", CheckSquare],
    ["notifications", "Notifications", Bell],
  ] as const;
  return (
    <div className="shell">
      <aside className="sidebar">
        <Link href="/dashboard" className="brand">
          <span className="brand-icon">e</span>encova
          <ArrowUpRight size={14} />
        </Link>
        <div className="workspace-label">WORKSPACE</div>
        <div className="nav-label">YOUR WORKSPACE</div>
        <nav className="nav" aria-label="Main navigation">
          {items.map(([path, label, Icon]) => (
            <Link key={path} href={`/${path}`}>
              <Icon size={17} />
              {label}
            </Link>
          ))}
          {["SUPER_ADMIN", "HR_ADMIN"].includes(person.role) && (
            <Link href="/schedules">
              <CheckSquare size={17} />
              Schedules
            </Link>
          )}
          {person.role === "SUPER_ADMIN" && (
            <Link href="/audit">
              <Shield size={17} />
              Audit log
            </Link>
          )}
        </nav>
        <div className="sidebar-footer">
          <div className="user">
            <span className="avatar">{person.displayName.slice(0, 1)}</span>
            <div>
              {person.displayName}
              <small>{person.role.replaceAll("_", " ").toLowerCase()}</small>
            </div>
          </div>
          <Logout />
        </div>
      </aside>
      <div className="main">
        <header className="topbar">
          <strong className="mobile-brand">encova workspace</strong>
          <span>
            Workspace{" "}
            <span style={{ margin: "0 12px", color: "#c4cec5" }}>/</span>
            <strong>Encova Solutions</strong>
          </span>
          <span>
            {new Intl.DateTimeFormat("en-GB", {
              timeZone: "Asia/Karachi",
              weekday: "short",
              day: "numeric",
              month: "short",
              year: "numeric",
            }).format(new Date())}
          </span>
        </header>
        <main className="content">{children}</main>
      </div>
    </div>
  );
}
