# Calendar, project/task and organization management

## Calendar

Super Admin opens Schedules to define immutable shift policies, assign staff and replace a current/future assignment. Replacement requires a current version and reason. It splits the original range when prior dates exist, retaining those dates and all snapshots. Blank end retains the existing end; an explicit new end can extend/shorten the replacement if no other assignment overlaps. Recorded attendance or active leave reservations in the affected interval block replacement. Use a later date or resolve leave explicitly. Super Admin remains exempt from staff schedules/punches.

Working weekdays are checkboxes. Shift end must be later than shift start; 17:00 is 5 PM. Create a new policy when rules change. Holidays can be added/edited/removed prospectively; recorded attendance and reserved leave prevent changing that date’s work calendar. Shared calendar locks and per-person serialization protect concurrent work. Historical records are retained.

## Work lifecycle

Open a project name for its detail/members/manage screen. Current project managers (Team Lead) and Super Admin can edit, archive and restore. Archive rejects open work unless the actor explicitly requests cancellation with a reason. Restore preserves canceled status; reopen tasks individually. Removing membership is blocked for the manager, open assignees and pending reviewers. Successful removal revokes current project visibility while preserving work history.

Task details include metadata editing, active-member reassignment, reasoned cancel/reopen/independent return and comments. Reassignment/editing during review is blocked. Return records immutable REQUEST_CHANGES feedback; self-review remains forbidden. Approved/canceled tasks must be reopened before editing/commenting. Project archive makes all task mutations read-only. Scoped task/project detail APIs return 404 outside visibility.

## Organization and policies

Super Admin opens Organization to manage departments and teams. Referenced teams/profiles prevent archival. Team leads must be active Lead/Super Admin accounts. Employee placement links open employment profiles with department/team/manager, joining/end dates, work mode and optional private contact. A team must match its department. Manager cycles are rejected under a shared hierarchy lock, including competing updates. Team/profile changes are versioned/audited; current team leads determine report visibility.

Private contacts are visible only through the self/Super Admin detail boundary and are omitted from organization DTOs, audit bodies and mutation results. HR intentionally keeps its reduced interface. Settings contains company name, fixed supported Asia/Karachi timezone, workweek, report cutoff/reminder control and explicit policy confirmation. Unconfirmed settings stay labeled as demo defaults. Settings never rewrite historical attendance or assigned policies.

Migrations eleven through thirteen add versions, immutable task comments and versioned company settings/employment end dates. Apply through the controlled migration connection before deploying code. New tables use RLS with server-only grants. No passwords or billing settings change.
