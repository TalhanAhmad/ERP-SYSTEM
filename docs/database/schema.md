# Implemented persistence

Prisma schema and six executable migration directories are authoritative. Auth: User, Session, Account, Verification, AuthRateLimit. Work: Person, Project, ProjectMember, Task, Submission, Review. Shared: Notification, Audit, Idempotency, RateLimit, Outbox. Company day: SchedulePolicy, ScheduleAssignment, Holiday, AttendanceDay, AttendanceEvent, AttendanceCorrection, LeaveRequest, LeaveDate, DailyReport, ReportRevision. Organization foundation: Department, Team, EmployeeProfile.

The organization tables are foundations for current-team report scoping; complete organization management is unfinished. No internship schema is implemented.

Reviewed integrity SQL adds foreign keys for scalar reference columns, partial active-leave uniqueness, date/status constraints, attendance day/user consistency and immutable event/history triggers. Do not remove these constraints through schema-only regeneration. Prisma's scalar-only models do not express every SQL foreign key; future migration diffs must be reviewed against this SQL before application. In particular, do not accept generated constraint drops without adding the corresponding Prisma relations or preserving the SQL.

Domain IDs are UUIDs; auth IDs follow Better Auth's supported schema. UTC instants use timestamptz; work dates use DATE. Immutable history rejects UPDATE and DELETE at database level (TRUNCATE remains an administration operation). Raw event data is preserved when correcting effective summaries.

Domain mutations serialize actor checks/idempotency, acquire business resource locks, check versions and commit records/audit/notifications atomically. Serializable failures and deadlocks are retried with bounded retries. Date advisory locks serialize leave approval and attendance. Schedule-assignment overlap checks lock the affected Person row.

## Supabase transition

Person.supabaseUserId is a separate nullable unique provider UUID; the existing authUserId relationship is preserved for local compatibility. Invitations have persisted provisioning state, attempt UUID and lease expiry. The sixth migration is additive and does not rewrite old auth records or domain IDs. Supabase-managed auth/storage schemas are outside Prisma ownership.

Apply supabase/setup.sql under controlled hosted migration credentials. It enables RLS on application tables, denies direct anonymous/authenticated access and allows the restricted server connection through encova_app. Business authorization still runs in services; Prisma does not impersonate each auth.uid. The optional private-bucket section runs only where the Supabase storage schema exists. It has not been demonstrated on a hosted project.
