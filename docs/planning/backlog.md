# Remaining release work

This list is deliberately explicit: the full supplied specification is not complete. Existing services and screens are an initial implementation, not pilot acceptance.

## Supabase/Vercel cutover priority

- The personal demo is already deployed to isolated Supabase/Vercel projects. Complete company production acceptance separately; do not treat the demo as acceptance of the full specification.
- Verify an owned Resend sending domain and complete employee invitation/reset inbox acceptance plus an unattended mail retry worker. The restricted personal-demo sender has verified owner-only SMTP/inbox delivery. The daily attendance schedule is registered/enabled; observe its first natural invocation. Pooled runtime/controlled migrations, closed signup, initial hosted admin linkage and private bucket are implemented and verified.
- Complete live Auth/reset/session-revocation/MFA acceptance, actual function/pool measurements and backup restore. Bounded private task-submission upload/download and access tests are now implemented and verified.
- Remove the temporary local Better Auth compatibility only after the Supabase local/staging/production flows are verified; keep domain IDs/history.
- Keep both provider contract tests and live Supabase acceptance. Current live sessions/work/attendance are verified with synthetic records; inbox/reset delivery, provider-wide revocation and MFA acceptance remain.

## Identity and people

- Invitation resend/revoke UI/API and expiration/revocation/concurrency tests are implemented. Employee email/reset delivery, privileged MFA and recovery procedures remain; Talha selected Resend but confirmed no domain is owned. The provider test sender reaches only the owner.
- Basic Super Admin account detail/profile editing, role/status UI, linked reactivation and directory filtering/pagination are deployed and verified. Department/team administration, manager-cycle protection, membership-change audit and employment profiles are deployed and verified in the completion pass. Verified login-email changes remain. HR intentionally keeps its reduced scope.
- Provider-wide session revocation, richer identity lifecycle controls and verified login-email changes remain separate release requirements.

## Work management

- Initial private attachments are delivered (4 MiB, PDF/PNG/JPEG/UTF-8 text, per-revision history). Larger/resumable files, broad retention/orphan tooling and full file scanning/format validation remain separate extensions.

- Project/task lifecycle and comments are deployed and verified in the completion pass (281 tests, green CI and 18 hosted checks).
- Precise server pagination/filter/sort/search contracts, task-detail read API, username picker scoped to a selected project, full OpenAPI DTOs.
- Current UI lists cap at 100 records; advanced table controls, saved views, keyboard grid navigation, bulk changes, CSV preview/commit and exports remain.

## Attendance, leave and reports

- Calendar administration and schedule replacement with history/race protections are deployed and verified (281 tests, green CI and 18 hosted checks).
- Full attendance HR date filters/drilldowns, independent correction rejection reasons, administrative reconciliation retry/audit.
- Report links, cutoff/late snapshots, calendar/leave missing status and revision history are implemented and locally verified. HR report status is superseded by the owner’s focused HR scope. Hosted acceptance is underway.
- Durable attendance jobs/attempts, Operations monitoring, audited resume/retry and daily Hobby schedule are implemented. First natural scheduled invocation, report reminders, invitation cleanup, broader job types, advanced monitoring/pagination/alerts and historical-gap detection remain. Email leases and restricted owner inbox delivery are verified; a verified domain and unattended retry worker remain.

## Internships and operations

- Internship enrollment, mentor assignment, evidence-linked milestones and weekly feedback are implemented and passed the full 300-test acceptance; hosted publication/verification is underway.
- Company settings, scoped HR audit view, operational failure dashboard, notification preferences and mark-all-read.
- Verified company sender/domain, company hosting approval, security headers/CSP review and privileged MFA rollout. Restricted hosted runtime roles are already configured.
- Representative 100-user performance measurement, broad accessibility audit, full pilot browser journey, backup restore drill, incident/rollback exercise.
- Maintain clean-runner CI verification for each source milestone and record its exact run/commit in the test results.

Learning milestones remain unconfirmed until Talha demonstrates the relevant concepts. Permission to build across milestones does not fabricate learning completion.

## Delivered dashboard/attendance refinement — 9 November 2026

The approved Assignments/filter/create structure, clickable matching overview cards, paginated Projects and Super Admin attendance exemption are implemented, deployed and verified (260 automated tests, green CI and 24 hosted checks). HR, Team Lead and Member retain personal punches; HR keeps focused staff visibility and leave approvals. No migration or credential change is required. The broader dashboard contract, advanced tables, organization/internship/settings modules and company release gates above remain open.
