# Focused HR and shared announcements

The owner's 8 November 2026 change replaces the broader HR interface with Overview, Attendance, Leave approvals and Notifications. Other roles retain their work screens. HR no longer has People/invitations, projects/tasks, schedules, corrections, reports, Operations, audit or announcement-management access through pages/APIs. Super Admin retains administration and schedule/correction controls.

## HR use

Overview and Attendance show active people by display name/username, today's check-in/out times in Karachi, and Checked in, Checked out, Not checked in or On leave. Counts include pending leave approvals. Named rows refresh every 30 seconds while the tab is visible; manual refresh is available. Not checked in does not assert an absence or a scheduled shift. No attendance event is fabricated by loading these views.

Leave approvals shows other people's requests with names and approve/reject controls. HR's personal leave form and approved-request cancellation action are omitted. Existing independent-decision, version, attendance-conflict, audit and personal-notification protections remain. HR cannot approve their own request. Private task/leave notifications remain recipient-scoped.

## Announcement use

Super Admin opens Announcements to publish one title/message. All active signed-in roles see the same banner on every workspace screen, including Notifications. Only Super Admin can publish, edit or delete. Saving an edit restarts the 24-hour period; early deletion is available. Content is plain text, and expiry/audience fields cannot be supplied by a browser caller.

One protected database slot prevents competing admins creating multiple announcements. Optimistic record ID/version checks prevent a stale edit/delete affecting a replacement. Audit stores actions/versions without message copies; mutation/idempotency results also omit message text. Anonymous and direct Data API access remain denied.

The message becomes unavailable to readers at its expiry. An open page removes it using its expiry timer; publish/edit/delete changes refresh within 20 seconds or on returning to the tab. Expired database content is physically removed on the first authenticated read after expiry, or by the existing daily job cleanup if the workspace is idle. It is not claimed that Vercel Hobby runs a cleanup every minute or that idle database bytes are deleted at the exact expiry second. Public visibility does not depend on waiting for the cleanup schedule.

The tenth additive migration introduces Announcement with RLS, restricted server-role grants, a singleton constraint, bounded content and author foreign keys. Existing invitation, employee, task, attendance and immutable audit/history records are retained. No separate backend, new email provider or billing upgrade is required.

## Verification

Tests cover administrator-only mutations, uniform role visibility, private notifications, strict inputs, 24-hour TTL, renewed edit TTL, stale versions/IDs, concurrent publication, idempotency and expired-content deletion. Browser tests cover named attendance transitions and leave approval with reduced HR navigation, plus announcement propagation/edit/delete and automatic disappearance on an already-open page using only a controlled synthetic short expiry.

The first browser edit lookup exposed a nested textarea label including its initial text. Explicit label IDs fixed the accessible field association; the full announcement journey then passed. Hosted tests must modify only an owned synthetic announcement and preserve any announcement created by the owner concurrently.
