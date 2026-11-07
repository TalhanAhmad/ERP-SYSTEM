# Milestones

Proposed source plan; statuses are in daily files and progress.md.

| Day | Acceptance goal |
| --- | --- |
| [001](days/day-001.md) | Inspect repo and assumptions; choose compatible versions; record reuse/new-repo decision and setup |
| [002](days/day-002.md) | Initialize app strict typing lint and scripts; local app and typecheck work |
| [003](days/day-003.md) | Create docs and progress workflow; all days pending and resumption instructions clear |
| [004](days/day-004.md) | Configure PostgreSQL and migrations; clean test database can be recreated |
| [005](days/day-005.md) | Integrate auth library and closed registration; anonymous/domain-unlinked access rejected |
| [006](days/day-006.md) | Bootstrap super admin and session lifecycle; current-user endpoint and logout verified |
| [007](days/day-007.md) | Implement domain roles and policy helpers; role matrix unit tests pass |
| [008](days/day-008.md) | Build invitation tokens and provisioning; expired and reused token tests pass |
| [009](days/day-009.md) | Add mail adapter and outbox foundation; invitation reaches development mail catcher |
| [010](days/day-010.md) | Build acceptance/reset screens; real account setup and reset flow verified |
| [011](days/day-011.md) | Build people profiles and directory; private fields excluded by role |
| [012](days/day-012.md) | Add departments teams and manager rules; membership changes audited |
| [013](days/day-013.md) | Add deactivation and role change; revoked access and last-admin guard verified |
| [014](days/day-014.md) | Build reusable layout and table controls; keyboard/mobile shell checked |
| [015](days/day-015.md) | Complete role-specific navigation; unauthorized routes and DTOs tested |
| [016](days/day-016.md) | Build project schema and services; CRUD and manager scope tests pass |
| [017](days/day-017.md) | Build project list/detail/membership UI; membership removal rules enforced |
| [018](days/day-018.md) | Build task creation and user picker; assignment uses ID and validates reviewer |
| [019](days/day-019.md) | Build personal work list and task detail; scope and filter counts match |
| [020](days/day-020.md) | Implement task state transitions and blockers; illegal transitions rejected |
| [021](days/day-021.md) | Implement immutable submissions; revisions and idempotent submit verified |
| [022](days/day-022.md) | Implement review decisions; self-review and concurrent duplicate review rejected |
| [023](days/day-023.md) | Build review queue and feedback UI; return/resubmit/approve journey passes |
| [024](days/day-024.md) | Add comments archive/reopen and audit; lifecycle rules verified |
| [025](days/day-025.md) | Build report schema and drafts; one report per user/date enforced |
| [026](days/day-026.md) | Build report submit/return/acknowledge; access and immutable submissions tested |
| [027](days/day-027.md) | Build report screens and missing-report query; cutoff and leave exceptions covered |
| [028](days/day-028.md) | Build schedule policies and effective assignments; overlaps rejected |
| [029](days/day-029.md) | Build holidays and schedule settings UI; policy snapshots and date rules checked |
| [030](days/day-030.md) | Build attendance events and idempotent check-in; duplicate and off-day cases pass |
| [031](days/day-031.md) | Implement check-out and daily summary; event order and duration tests pass |
| [032](days/day-032.md) | Implement attendance finalizer; absence/open-checkin and retries verified |
| [033](days/day-033.md) | Build personal attendance card/history; mobile check-in/out workflow works |
| [034](days/day-034.md) | Build HR attendance grid; scoped counts and drill-down agree |
| [035](days/day-035.md) | Implement correction requests and decisions; raw history and version guard verified |
| [036](days/day-036.md) | Build correction UI; independent approval and error recovery demonstrated |
| [037](days/day-037.md) | Implement leave and reserved dates; overlapping pending/approved leave rejected |
| [038](days/day-038.md) | Implement leave decisions and attendance interaction; approval/check-in race tested |
| [039](days/day-039.md) | Build leave calendar and request UI; full workflow and private-note access checked |
| [040](days/day-040.md) | Run integrated attendance/leave scenarios; date boundaries and retries pass |
| [041](days/day-041.md) | Build internship enrollment and mentor policies; one active enrollment enforced |
| [042](days/day-042.md) | Build learning milestones/task links; only eligible work can be linked |
| [043](days/day-043.md) | Build weekly feedback and intern UI; mentee/mentor/HR visibility tested |
| [044](days/day-044.md) | Implement milestone completion; unapproved required task blocks completion |
| [045](days/day-045.md) | Add persistent in-app notifications; recipient ownership and read state verified |
| [046](days/day-046.md) | Complete worker leases/retries/reminders; recovery and deduplication tested |
| [047](days/day-047.md) | Add editable task/people tables; updates call validated domain services |
| [048](days/day-048.md) | Add personal saved views and filters; invalid columns/filters rejected |
| [049](days/day-049.md) | Implement bulk task update; authorization/version failures roll back batch |
| [050](days/day-050.md) | Implement task CSV preview/commit and exports; limits and formula sanitization pass |
| [051](days/day-051.md) | Build super-admin dashboard and action queues; numbers match scoped source records |
| [052](days/day-052.md) | Build HR lead and personal dashboards; role-specific evidence verified |
| [053](days/day-053.md) | Build settings/audit screens and admin operational errors; filters and access checked |
| [054](days/day-054.md) | Run security tests and configure privileged MFA; direct API bypass tests pass |
| [055](days/day-055.md) | Run complete browser journeys and mobile/accessibility review; defects recorded/fixed |
| [056](days/day-056.md) | Profile realistic data and improve measured slow queries; record before/after results |
| [057](days/day-057.md) | Configure CI and production build checks; clean checkout reproduces results |
| [058](days/day-058.md) | Prepare approved pilot deployment and worker; migration/backup/smoke steps documented |
| [059](days/day-059.md) | Perform backup restore and operational failure drill; recovery evidence recorded |
| [060](days/day-060.md) | Conduct pilot acceptance and final documentation review; open issues and launch decision explicit |
