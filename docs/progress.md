# Encova Workspace progress

Last updated: 2026-11-12 (Asia/Karachi)

Finance extension: started from the newly supplied specification. Its assessment,
access foundation and separate 48-milestone tracker are in [finance progress](finance/progress.md).
This does not replace or complete the original ERP learning roadmap below.

- Total proposed learning days: 60
- Completed learning days: 0 — no learner demonstration has been recorded
- Current learning day: 001
- Current learning status: Awaiting learning check
- Remaining learning days including unfinished learning: 60
- Build scope: explicitly authorized across milestones by Talha
- Implementation status: the authorized completion pass now includes calendar/lifecycle/organization, reports/internships/maintenance, structured tables/import/export, account-security capability and isolated recovery/load/accessibility verification. The latest readiness release passed 331 automated and 44 follow-up hosted checks, plus actual hosted ERP/Storage logical recovery, and is live. Company rollout and learner sign-off remain separate.
- Publication: source fcb7bc71a453eb59e1c645b07e8ee997814d52db, CI 42976770350 SUCCESS, Vercel dpl_2SSKGD2xS2jojkBuHhoqN6xjLCa4 READY at https://encova-workspace.vercel.app. Latest verification: 131 unit + 179 integration + 21 browser tests (331), 44 follow-up live checks, actual hosted ERP/Storage logical recovery and successful natural processing on 11 November.

## Implemented evidence

Real application and PostgreSQL migrations now exist. Authentication/invitations, projects, task revision/review, attendance, leave/corrections, reports, notifications, audit and initial role/deactivation services are implemented to the extent described in [the build report](build-report.md). Tests and known failures are recorded in [results](testing/results.md); steps are in [the work log](work-log.md).

## Remaining release work

See [the release checklist](planning/backlog.md). Organization/internships and reports are deployed. Tables/imports/security are deployed and live-verified. An isolated full-schema/data recovery drill passed; hosted backup/PITR and Storage restoration are not claimed.

## Blockers and dependencies

Actual company policies, a verified sending domain, full employee inbox delivery and owner pilot/MFA rollout decisions remain unresolved for company use. PostgreSQL client tools and an isolated restore demonstration are now complete. Git author identity has been supplied and configured locally. GitHub CLI browser authentication completed as TalhanAhmad with credentials stored in the system keyring; repository ADMIN access and HTTPS push succeeded. Node/pnpm/PostgreSQL were recovered for development; Docker remains unavailable.

## Production stack decision

Talha finalized Next.js + TypeScript + Tailwind, Next Route Handlers/shared services, Supabase PostgreSQL/Auth/Storage, Prisma and Vercel. See [ADR-002](decisions/ADR-002-supabase-vercel.md) and [deployment guide](operations/deployment.md). Better Auth remains local compatibility only; hosted deployments must select Supabase. The existing local admin is preserved.

Official CLI browser authentication resolved the connected-tool gap. Created a separate Encova Solutions organization and Encova Workspace Demo Supabase project in Mumbai, and encova-workspace on Vercel Hobby. The first fifteen hosted migrations and database/Auth/private-storage preflight passed. The deployment is READY at https://encova-workspace.vercel.app; live API/browser and attendance acceptance checks passed. This is a personal testing demo with no billing upgrade.

## Current completion pass

The authorized completion pass is finished and published. Sign in again after the app-session cutover. Future edits can build on this release. A natural scheduled invocation is now verified on 10 November at 00:53 UTC (Vercel HTTP 200, vercel-cron/1.0, successful attendance and maintenance records). Daily maintenance now includes report reminders, expired-invitation cleanup and a bounded permitted-email retry. Resend remains owner-only until a verified domain is supplied. Account-security setup is optional for now; the owner and exploration accounts are not enrolled automatically. Details and evidence are recorded in [table/security/recovery operations](operations/tables-security-recovery.md).

## Current demo password policy

At the owner's explicit request, the personal-demo provider and matching application forms/services now accept passwords of at least 8 characters. The live owner password was changed privately and API/browser sign-in, old-password rejection, mobile access and sign-out passed. Company policy should be reviewed before staff rollout; the owner intends to change the demo password at project completion. No password is recorded in this report.

## Live role exploration accounts

Three owner-requested demo accounts now remain ACTIVE: HR Admin, Team Lead and Member, alongside the existing Super Admin. Twelve targeted live checks passed. Team Lead/Member share a synthetic project with assigned and reviewable work; HR has demo schedules and a pending leave request. Login emails, scope and cleanup rules are in [demo account operations](operations/demo-accounts.md). Credentials are handed directly to the owner and excluded from this report. Application source/deployment did not change for this data-only setup.

## Current implementation work

Focused HR attendance/leave/notifications and the shared Super Admin announcement are deployed and verified. The first fifteen hosted migrations and runtime preflight passed. All 235 local and 21 targeted hosted checks passed; exact scope/expiry behavior is in [HR and announcement operations](operations/announcements-hr.md). The persistent demo accounts remain ACTIVE; only the new verification fixture was deactivated.

## Account-management work

Super Admin People search/filter/pagination and per-account profile/role/status controls are deployed and verified. All 250 automated tests, 22 hosted checks and source CI passed. HR remains focused on attendance, leave approvals and notifications. See [account management](operations/people-management.md). Department/team management and verified email changes remain separate follow-ups.

## Dashboard and attendance update delivered

Implemented the approved Assignments structure, clickable matching summary cards and Super Admin attendance exemption. HR, Team Lead and Member retain personal check-in/out. All 260 automated checks passed (121 unit, 126 integration, 13 browser), plus strict typing/lint and production build. Source ca49e9f is committed/pushed, CI 42606060629 passed, and the Vercel release is READY. All 24 hosted checks passed. New verification accounts were retired and their test project archived; existing exploration accounts and credentials are preserved. See [assignment and attendance operations](operations/assignments-attendance.md).

## Authorized completion pass — underway

The owner requested completing remaining implementation before later revisions. Calendar replacement/holidays, project/task lifecycle, organization/employment profiles and company settings are implemented and passed 281 automated checks (121 unit, 144 integration, 16 browser), plus typing/lint/build. Source 78a03c5 is pushed/deployed; CI 42639937002 and all 18 live checks passed. Reports/notifications/jobs are in progress; internships, advanced tables/import/export and release acceptance remain queued in [the completion plan](planning/completion-plan.md). External sending-domain and company-policy/pilot decisions remain owner dependencies; independent work continues.

## Reports, internships and maintenance — local acceptance complete

Reports now have scoped links/status/history, first-submission timing and independent reasoned review. Internships have guarded enrollment, evidence-based milestones and private weekly feedback. Notifications support preferences/read-all; maintenance has deduplicated reminders, expiry cleanup, retry leases and Operations visibility. Focused HR is excluded from report obligations because its report-writing interface is intentionally unavailable. All 300 automated checks passed (121 unit, 161 integration, 18 browser), with production build and typing/lint. Fifteen hosted migrations and preflight passed. Source 60c1d3d is deployed, CI 42661510686 passed and all 20 targeted live checks passed. Advanced tables/import/export and final security/release verification continue afterward.

## Company-readiness follow-up — 11 November 2026

The owner authorized the remaining independent work. Implemented verified own login-email changes and safe callback/status screens, kept disabled pending domain/inbox setup. Local regression passed 331 tests with typing/lint/build. A read-only consistent snapshot of the actual hosted public ERP database restored with all 47 tables/1,593 rows/185 constraints matching; all 9 private objects were restored into a separate test bucket and verified against attachment checksums, then that bucket was removed. Source records/objects were unchanged. Auth/PITR/off-site strategy and human rollout decisions are not marked complete. See operations/login-email.md, operations/company-pilot.md and planning/rollout-plan.md. Source fcb7bc7 passed CI 42976770350, deployed as dpl_2SSKGD2xS2jojkBuHhoqN6xjLCa4, and passed all 44 follow-up live checks. Today’s natural attendance/maintenance also succeeded. Company policy values were requested but remain unconfirmed; restricted email and optional owner MFA remain unchanged.

## Confirmed workweek — 11 November 2026

The owner selected Monday–Saturday. Saved CompanySettings.workweek=[1,2,3,4,5,6] through the versioned live API (settings version 2), then verified read-back and actual browser checkboxes. Sunday is excluded. Other settings and the unconfirmed overall-policy flag were preserved. Attendance follows separate employee schedules; shift start/end values were requested before configuring those prospectively. See operations/company-policy.md.

## Confirmed shift — 11 November 2026

Owner accepted 9:00 AM–5:00 PM, Monday–Saturday, Asia/Karachi. Assigned the new ongoing company shift to all three active non-Super-Admin staff from 12 November. Eight live checks passed, including Sunday off, earlier history preservation and Super Admin exemption. Prior assignment segments end on 11 November; earlier attendance and raw events are unchanged. Grace/closing buffer remain zero. Report deadline confirmation and leave rules remain pending; the full-policy confirmation flag stays unchanged.

## Confirmed report deadline — 11 November 2026

Owner confirmed daily reports due at 5:00 PM Asia/Karachi. The live value was already 17:00 and was verified without rewriting settings or report history. Five targeted checks passed: API/browser value, cutoff boundary behavior, Sunday exemption, retained report metadata and preservation of other settings. Leave approval/annual allowance preference is now requested; overall company-policy sign-off remains unchanged.

## Confirmed leave workflow — 11 November 2026

Owner selected the current HR approval-only workflow with no fixed annual leave quota. Eight targeted live checks passed for pending/independent approval, actual HR approve/reject forms, overlap/off-day handling, focused HR navigation and owned-fixture cleanup. No code/schema/deployment or quota-setting change was needed. All four requested operating choices—working days, shift hours, report deadline and leave workflow—are now recorded in operations/company-policy.md. Existing security/billing settings and historical leave/attendance were preserved.

## Finance owner controls — 12 November 2026

F04 implementation is complete with 369 passing local tests (133 unit, 211 real PostgreSQL integration, 25 browser), strict typing/lint and both builds. Owner-only grants/revokes, recipient-accepted transfers, fresh password plus hosted TOTP, operator-only setup/recovery and database owner/identity protections are implemented. Finance remains disabled live; no hosted grant/migration/device enrollment occurred. The finance plan is now 4/48 milestones complete; accounting core work begins at F05. See [finance progress](finance/progress.md). Source 9fea005 is pushed; clean-runner CI 43173242785 passed all checks.

F04 clean-runner evidence: [CI 43173242785](https://github.com/TalhanAhmad/ERP-SYSTEM/actions/runs/43173242785) passed on source 9fea005624c8c734659e289da85d114499482cfd. No live finance migration/grant or merge occurred.

## Finance account/period setup — 12 November 2026

F01–F05 implementation acceptance is complete: 5/48 finance milestones, 43 remaining. Accounts/periods now have current-owner setup, selected-admin read-only access, strict configuration/version/hierarchy/usage rules and permanent restricted receipts/audit. Exact PKR strings and high-precision line rounding are shared primitives. Local acceptance totals 424 distinct tests (167 unit, 231 PostgreSQL integration, 26 browser), typing/lint and both builds. Final repeats/publication/CI are tracked in the finance results. Next F06 builds the posting engine; no journal, opening balance, company chart or fiscal year is seeded. Hosted ERP remains unchanged with finance disabled and 17 migrations; the test schema has 22. Word report and work log include this milestone. See the separate finance progress/results for current publication evidence.

F05 clean-runner [CI 43215176008](https://github.com/TalhanAhmad/ERP-SYSTEM/actions/runs/43215176008) passed on source 109a83c9721be9017571b8cc78259c661f0e1820: all 22 migrations on fresh PostgreSQL, 167 unit + 231 integration + 26 browser tests (424), strict typing/lint, local/Supabase-mode production builds and docs. Browser suite passed in 1.5 minutes. Initial source 03dc3e2 also passed CI 43214839447; counts are not doubled. No hosted migration, finance grant, merge or launch occurred.

## Finance through F10 — 12 November 2026

F01–F10 engineering acceptance is complete: 10/48 finance groups,38 remaining. Ordinary journal posting/reversal/idempotency, database balancing/immutability, dated core subset, shared accessible registers/drawer editing, parties/cash mappings and complete parent search are implemented. 488 distinct local tests: 185 unit, 275 real PostgreSQL integration and 28 Chromium browser. Strict typing/lint and both local/Supabase-mode production builds passed. Test schema has27 migrations; hosted ERP keeps17 with finance disabled. No company books, credential change, hosted migration/grant, merge or deployment occurs. Publication/clean CI follows in the focused finance results. Original ERP/learning progress is unchanged. Next F11: earned/deferred invoices.

Exact-source [CI 43238001511](https://github.com/TalhanAhmad/ERP-SYSTEM/actions/runs/43238001511) passed on 4be8c72eed903d2acd7b22be793a76bba638c55a: 185 unit +275 PostgreSQL integration +28 Chromium browser tests (**488**), all27 migrations applied to fresh PostgreSQL, strict typing/lint, local and Supabase-mode production builds and documentation. CI browser suite passed in2.2 minutes; the complete verify job took5m19s. Source was pushed on finance/foundation; PR#1 is now merged into main at 7d9ca2e. Hosted ERP retains17 migrations with finance disabled; no live finance migration/grant or deployment occurred.

## PR merge — 12 November 2026

PR #1 was merged into main at 2026-11-12 15:17:24 UTC (20:17 Pakistan time), after Talha explicitly requested the merge. Merge commit: 7d9ca2e19b1b912b8b65cb2f2d24bc94def7abde. A merge commit preserved all ten individual finance commits and their original attribution. PR-head 9256e8b had passing CI 43239515265 before merging. Local main was fast-forwarded to the merged result; application/schema content is unchanged from the verified PR head. Finance remains disabled by default; no manual hosted migration or enablement was performed.


## Finance F11 — 13 November 2026

F11 earned/deferred invoice backend is locally accepted: typed exact sources, private versioned API, shared emitter, immutable dated AR/BILLED events and posted client snapshots. Full regression passed207 unit +299 PostgreSQL integration +29 Chromium tests (**535**), strict typing/lint and local build. Final hosted-mode build, report validation and exact-source CI publication are in [F11 verification](finance/testing/F11-results.md). F12 remains invoice editor/preview/private printable document. Test schema28 migrations; no hosted finance migration/grant/enablement, real financial seed or deployment. Original ERP learning acceptance remains separate.


[CI 43399849090](https://github.com/TalhanAhmad/ERP-SYSTEM/actions/runs/43399849090) passed on source d74828436b29026e3b76a3fceea27b81047cd0e6: all28 additive migrations on fresh PostgreSQL, 207 unit +299 PostgreSQL integration +29 Chromium browser tests (**535**), strict typing/lint, local and Supabase-mode production builds and documentation. Source is pushed in [draft PR #2](https://github.com/TalhanAhmad/ERP-SYSTEM/pull/2) on finance/invoices-f11; no merge or hosted finance release was performed.


## Finance completion through F15 — 13 November 2026

F12 invoice screens/private PDF, F13 receipts, F14 client advances and F15 credits/refunds/dated corrections are locally accepted and separately committed/pushed as requested. Final **596 tests** passed (216 unit +346 PostgreSQL integration +34 Chromium), strict typing/lint, both production builds and all60 concrete API paths/verbs/references. [Exact current results](finance/testing/F12-F15-results.md) record the separate source commits and final F15 CI after publication. Original ERP learning acceptance remains separate.33 test migrations; no hosted finance migration/grant/enablement, real financial seed, deployment, client email or merge.


[CI 43419008430](https://github.com/TalhanAhmad/ERP-SYSTEM/actions/runs/43419008430) passed on exact source **b5a424bc42121a185da4d44d857e5ad59040107b**: all 33 migrations on fresh PostgreSQL, 216 unit +346 integration +34 Chromium tests (**596**), strict typing/lint, local and Supabase-mode production builds and documentation/API verification. Each requested milestone was committed/pushed separately; [draft PR #2](https://github.com/TalhanAhmad/ERP-SYSTEM/pull/2) now covers F11–F15 on finance/invoices-f11. No merge or hosted finance release occurred.
