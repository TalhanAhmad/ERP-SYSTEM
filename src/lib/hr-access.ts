import { invariant } from "@/server/errors";
const sections = new Set(["dashboard", "attendance", "leave", "notifications"]);
export function hrSectionAllowed(role: string, section: string) {
  return role !== "HR_ADMIN" || sections.has(section);
}
export function hrApiAccess(role: string, method: string, path: string) {
  if (role !== "HR_ADMIN") return;
  const allowed =
    method === "GET"
      ? new Set([
          "me",
          "attendance",
          "attendance/me",
          "leave",
          "notifications",
          "hr/overview",
          "announcements",
        ]).has(path) || /^attendance\/[0-9a-f-]{36}$/.test(path)
      : method === "POST" &&
        (["notifications/read-all", "corrections"].includes(path) ||
          /^attendance\/check-(in|out)$/.test(path) ||
          /^leave\/[^/]+\/(approve|reject)$/.test(path) ||
          /^notifications\/[^/]+\/read$/.test(path));
  invariant(
    allowed,
    "FORBIDDEN",
    "HR access is limited to attendance, leave approvals and notifications.",
    403,
  );
}
