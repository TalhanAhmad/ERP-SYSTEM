"use client";
import { useId } from "react";
import { MutationForm } from "./mutation-form";
import type { AnnouncementView } from "./workspace-announcement";
export function AnnouncementForm({ item }: { item: AnnouncementView | null }) {
  const titleId = useId();
  const bodyId = useId();
  return (
    <>
      <MutationForm
        endpoint="/api/v1/announcements"
        label={item ? "Save announcement" : "Publish announcement"}
        successMessage="Announcement saved for everyone."
        transform={(fields) => ({
          title: fields.get("title"),
          body: fields.get("body"),
          ...(item
            ? { expectedId: item.id, expectedVersion: item.version }
            : {}),
        })}
      >
        <label htmlFor={titleId}>Title</label>
        <input
          id={titleId}
          name="title"
          required
          maxLength={120}
          defaultValue={item?.title ?? ""}
        />
        <label htmlFor={bodyId}>Message</label>
        <textarea
          id={bodyId}
          name="body"
          required
          maxLength={2000}
          rows={5}
          defaultValue={item?.body ?? ""}
        />
        <p className="note">
          Everyone in the workspace can see this. It disappears after 24 hours.
          Saving an edit starts a new 24-hour period.
        </p>
      </MutationForm>
      {item && (
        <MutationForm
          endpoint="/api/v1/announcements/delete"
          label="Delete announcement"
          successMessage="Announcement removed for everyone."
          transform={() => ({
            expectedId: item.id,
            expectedVersion: item.version,
          })}
        />
      )}
    </>
  );
}
