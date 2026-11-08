import { notFound } from "next/navigation";
import { context } from "@/server/context";
import { activeAnnouncement } from "@/modules/announcements/service";
import { AnnouncementForm } from "@/components/announcement-form";
export default async function Announcements() {
  const actor = await context();
  if (actor.role !== "SUPER_ADMIN") notFound();
  const item = await activeAnnouncement();
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">ONE MESSAGE FOR EVERYONE</span>
          <h1>Announcements</h1>
          <p className="muted">
            Publish one shared update for the whole workspace.
          </p>
        </div>
      </div>
      <section className="panel">
        <h2>{item ? "Edit active announcement" : "Create an announcement"}</h2>
        <AnnouncementForm
          key={item ? `${item.id}:${item.version}` : "new"}
          item={item}
        />
      </section>
    </>
  );
}
