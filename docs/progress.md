# Encova Workspace progress

Last updated: 2026-11-11 (Asia/Karachi)

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
