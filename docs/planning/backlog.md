# Completion and company-release checklist

The personal-demo completion queue is distinct from company rollout and learner demonstrations. Earlier entries are preserved in work-log/results; this current checklist supersedes stale feature-pending lists.

## Implemented in the authorized completion pass

- Focused HR attendance/leave/notification interface, personal HR/Lead/Member punches and view-only Super Admin attendance; singleton shared expiring announcements.
- Clickable matching dashboard cards, Assignments/create/filter workflow, project and task lifecycle/comments, independent revision/review, guarded manager transfer and private 4 MiB task evidence.
- Organization/departments/teams/employment profiles, manager-cycle protections, configurable demo company settings, prospective calendar/holiday management and immutable attendance/correction history.
- Linked/versioned daily reports, original cutoff/late snapshots, missing/calendar status, internship enrollment/milestones/evidence/mentor feedback, private preferences/read-all and durable daily maintenance/retries.
- Scoped table pagination/filter/sort, personal saved columns/views, keyboard operation, guarded inline edits, atomic bulk preview/commit, task CSV validation/preview/commit and safe filtered exports.
- Paginated notification/audit metadata, scoped overdue/missing-report/operational follow-up links, own Supabase TOTP capability, optional privileged MFA policy and immediate app-session revocation.
- Isolated database dump/restore with content fingerprints; bounded 100-member synthetic service measurements; representative automated WCAG A/AA scans, browser/mobile/security-header checks.

Delivered and verified for the authorized personal demo: source baf7d10, CI 42809226350, seventeen hosted migrations, 324 automated checks and 56 final live checks. Test fixtures were retired and persistent exploration accounts preserved. Natural daily processing and protected previous-deployment compatibility are verified.

## Owner or external dependencies before company rollout

- Supply an owned sending domain and verify it in Resend. Then verify actual employee invitation/reset delivery in multiple inboxes. The demo sender is intentionally restricted to the owner's verified inbox. Do not purchase a domain or remove the restriction automatically.
- Enroll the owner's authenticator with their own device, record a recovery procedure and decide when to enable privileged MFA. The capability is implemented; no owner factor or global requirement is activated automatically.
- Confirm real workweeks, shifts, report cutoffs and employee/leave policies. Existing settings are demo defaults until explicitly confirmed.
- Approve company hosting/billing and representative real-user pilot acceptance. The deployment remains the authorized personal demo on Hobby; no upgrade is performed.
- The actual hosted public ERP database and all private objects have now been logically backed up/restored in isolation and verified. Managed Auth/PITR/regional recovery, retention and an automated off-site destination still require a company decision; the logical drill does not establish those guarantees.
- Own verified login-email changes are implemented and contract/browser tested; they stay disabled on the live demo until a verified sender and independent inbox acceptance are available. Administrative editing of another user’s login email stays read-only.

## Future extensions outside this completion queue

Larger/resumable files and malware scanning, broad object-retention/orphan tooling, advanced monitoring/alert integrations and organization-specific payroll/leave/pay policies require separately defined scope. The current bounds and privacy rules are documented in the operational guides. These are not silently enabled for the personal demo.

Learning milestones remain unconfirmed until Talha demonstrates the concepts. Build authorization does not fabricate learning completion or company pilot sign-off.

## Follow-up implementation — 11 November 2026

The own-email workflow now requires current-password and MFA/session verification, dual-address confirmation and atomic same-ID synchronization with old-session revocation. Its feature flag remains off under restricted demo mail. Local verification passed 331 tests (131 unit, 179 integration, 21 browser) plus typing/lint/build. Actual hosted logical recovery verified 47 tables/1,593 records/185 constraints and 9 private files (all 9 matching attached-record digests); originals were unchanged and the new test bucket was removed. Source fcb7bc7 passed CI 42976770350, was deployed to Vercel and passed all 44 follow-up live checks. Human policy/device/domain/pilot decisions remain explicit.
