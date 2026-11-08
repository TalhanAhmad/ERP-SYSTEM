# Remaining release work

This list is deliberately explicit: the full supplied specification is not complete. Existing services and screens are an initial implementation, not pilot acceptance.

## Supabase/Vercel cutover priority

- The personal demo is already deployed to isolated Supabase/Vercel projects. Complete company production acceptance separately; do not treat the demo as acceptance of the full specification.
- Configure a verified email sender/company SMTP and recurring jobs. Pooled runtime/controlled migrations, closed signup, initial hosted admin linkage and private bucket are implemented and verified.
- Complete live Auth/reset/session-revocation/MFA acceptance, actual function/pool measurements and backup restore. Bounded private task-submission upload/download and access tests are now implemented and verified.
- Remove the temporary local Better Auth compatibility only after the Supabase local/staging/production flows are verified; keep domain IDs/history.
- Keep both provider contract tests and live Supabase acceptance. Current live sessions/work/attendance are verified with synthetic records; inbox/reset delivery, provider-wide revocation and MFA acceptance remain.

## Identity and people

- Invitation resend/revoke UI/API and expiration/revocation/concurrency tests are implemented. Real email/reset delivery, privileged MFA and recovery remain; Talha confirmed no email service exists.
- People detail/edit/profile screens, department/team administration, manager-cycle protection, team membership history and HR-safe directory/autocomplete scopes.
- Role/deactivation services exist; management UI and concurrent security-change coverage remain.

## Work management

- Initial private attachments are delivered (4 MiB, PDF/PNG/JPEG/UTF-8 text, per-revision history). Larger/resumable files, broad retention/orphan tooling and full file scanning/format validation remain separate extensions.

- Project detail/edit/archive/restore, membership removal, task editing/reassignment, reasoned cancellation/reopen, comments.
- Precise server pagination/filter/sort/search contracts, task-detail read API, username picker scoped to a selected project, full OpenAPI DTOs.
- Current UI lists cap at 100 records; advanced table controls, saved views, keyboard grid navigation, bulk changes, CSV preview/commit and exports remain.

## Attendance, leave and reports

- Holiday administration, schedule-assignment replacement/effective-date editing, comprehensive historical scheduling tests.
- Full attendance HR date filters/drilldowns, independent correction rejection reasons, administrative reconciliation retry/audit.
- Reports need task links, configurable cutoff/late flags, missing-report calculation with work-calendar/leave exceptions, report status counts for HR and accessible revision-history UI.
- Persistent global job-run records, report reminders, invitation cleanup and monitored scheduling are incomplete. Attendance reconciliation and email leases exist, but there is no deployed scheduler.

## Internships and operations

- Internship enrollment, mentor assignment, milestones, eligible task links, weekly feedback and their screens/tests are not implemented.
- Company settings, scoped HR audit view, operational failure dashboard, notification preferences and mark-all-read.
- Real SMTP delivery, company hosting approval, security headers/CSP review and privileged MFA rollout. Restricted hosted runtime roles are already configured.
- Representative 100-user performance measurement, broad accessibility audit, full pilot browser journey, backup restore drill, incident/rollback exercise.
- Maintain clean-runner CI verification for each source milestone and record its exact run/commit in the test results.

Learning milestones remain unconfirmed until Talha demonstrates the relevant concepts. Permission to build across milestones does not fabricate learning completion.
