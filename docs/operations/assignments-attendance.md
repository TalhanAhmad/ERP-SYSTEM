# Assignments and attendance roles

The owner approved this structure on 9 November 2026. The four work dashboard cards are links: Active projects → Projects filtered to active; Open assignments → Assignments/open; Awaiting review → Assignments/review; Approved work → Assignments/approved. Counts and list predicates share the same role/project scope. Root reviews cover the workspace; other roles see their designated review queue. Open means all states except APPROVED/CANCELED.

## Assigning work

Open Assignments, then Assign a task. Super Admin can choose any active project; Team Lead can choose only active projects they manage and belong to. Choose a project before choosing an assignee, then select a different reviewer. Both dropdowns show active members of the selected project. Changing the project clears both selections; changing the assignee clears the reviewer. Add missing people from Projects first. The backend independently validates membership, manager rights and reviewer independence.

Assignments supports view/project/search filters and 25-row pagination. Search matches task, project or assignee name/username. Successful creation opens Open assignments. Existing /tasks and /my-work list URLs remain supported; task detail and notification URLs remain /tasks/:id. Projects supports active/archive/all and name/description filters with the same pagination. API directories are GET /api/v1/assignments and /api/v1/project-directory. Invalid API filters are rejected. Invalid page filters show an error and safe defaults.

## Attendance

Super Admin opens Attendance to view named staff status and check-in/out times. Staff includes active HR, Team Lead and Member accounts and excludes all Super Admins. Filter by company date (today or earlier), status and person name/username. Counts cover the selected date’s full active staff; search/status filters narrow rows. Not checked in does not prove absence. Refresh occurs every 30 seconds in a visible tab or through the refresh control.

HR keeps Overview, Attendance, Leave approvals and Notifications. Attendance also includes My attendance today for HR. HR, Team Lead and Member record their own check-in/out using the same schedule, holiday, leave, server timestamp and idempotency protections. Without an effective schedule, the personal panel asks for a schedule. Other staff records cannot be punched through this form.

Super Admin has no personal punch controls; both direct punch endpoints return 403 before a ledger/event can be created. New schedules reject Super Admin targets. Job audience capture and reconciliation skip Super Admin, including preexisting assignments and people promoted after a job was queued. Existing raw events, historical attendance and immutable job/audit evidence remain intact.

No schema migration, credential change, billing change or announcement change is needed for this release. The persistent owner exploration accounts must stay active during live tests. Create and retire only new owned synthetic verification identities.

## Verification and publication

Source ca49e9f passed [GitHub CI 42606060629](https://github.com/TalhanAhmad/ERP-SYSTEM/actions/runs/42606060629). Local acceptance: 121 unit, 126 PostgreSQL integration and 13 Chromium tests (260 total), typing/lint and production build. Vercel deployment dpl_FyaWEkk2TToL7vZZ2GykwmctheTC is READY. All 24 hosted workflow, permission and cleanup checks passed. The newly created synthetic accounts were retired and their project archived; owner and persistent HR/Lead/Member exploration accounts remain active. Attendance/audit history is retained.
