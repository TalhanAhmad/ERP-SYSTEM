# Remaining release work

This list is deliberately explicit: the full supplied specification is not complete. Existing services and screens are an initial implementation, not pilot acceptance.

## Identity and people

- Invitation resend/revoke UI and API, expiration/revocation adversarial tests, reset delivery/browser journey, privileged MFA and recovery.
- People detail/edit/profile screens, department/team administration, manager-cycle protection, team membership history and HR-safe directory/autocomplete scopes.
- Role/deactivation services exist; management UI and concurrent security-change coverage remain.

## Work management

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
- Real SMTP delivery, deployment host approval, least-privilege production database roles, security headers/CSP review and privileged MFA rollout.
- Representative 100-user performance measurement, broad accessibility audit, full pilot browser journey, backup restore drill, incident/rollback exercise.
- CI configuration is committed for remote execution; a green GitHub Actions run must be separately observed after push.

Learning milestones remain unconfirmed until Talha demonstrates the relevant concepts. Permission to build across milestones does not fabricate learning completion.
