# Encova Workspace progress

Last updated: 2026-11-08 (Asia/Karachi)

- Total proposed learning days: 60
- Completed learning days: 0 — no learner demonstration has been recorded
- Current learning day: 001
- Current learning status: Awaiting learning check
- Remaining learning days including unfinished learning: 60
- Build scope: explicitly authorized across milestones by Talha
- Implementation status: personal-testing demo deployed with monitored attendance jobs, an enabled daily schedule, private revision attachments and invitation management, plus restricted Resend email/reset delivery. Full specification and company production acceptance remain incomplete.
- Publication: owner-requested demo password policy source 088a714 passed GitHub CI 42482165407 and is committed/pushed and deployed as dpl_4Tp4KQSx349F8kApPNLpNAdPvbRU. Local verification: 121 unit, 95 integration and 8 browser tests (224 total), plus five targeted live credential/mobile/sign-out checks. The prior email deployment passed 71 live checks; its evidence remains recorded separately.

## Implemented evidence

Real application and PostgreSQL migrations now exist. Authentication/invitations, projects, task revision/review, attendance, leave/corrections, reports, notifications, audit and initial role/deactivation services are implemented to the extent described in [the build report](build-report.md). Tests and known failures are recorded in [results](testing/results.md); steps are in [the work log](work-log.md).

## Remaining release work

See [the backlog](planning/backlog.md). No internship workflow, advanced spreadsheet/import/export, full organization management, complete job monitoring, pilot deployment or backup restore is claimed. A working UI/build is not production acceptance.

## Blockers and dependencies

Actual company policies, a verified sending domain, full employee email delivery and backup-client tooling/restore demonstration remain unresolved for pilot. Git author identity has been supplied and configured locally. GitHub CLI browser authentication completed as TalhanAhmad with credentials stored in the system keyring; repository ADMIN access and HTTPS push succeeded. Node/pnpm/PostgreSQL were recovered for development; Docker remains unavailable.

## Production stack decision

Talha finalized Next.js + TypeScript + Tailwind, Next Route Handlers/shared services, Supabase PostgreSQL/Auth/Storage, Prisma and Vercel. See [ADR-002](decisions/ADR-002-supabase-vercel.md) and [deployment guide](operations/deployment.md). Better Auth remains local compatibility only; hosted deployments must select Supabase. The existing local admin is preserved.

Official CLI browser authentication resolved the connected-tool gap. Created a separate Encova Solutions organization and Encova Workspace Demo Supabase project in Mumbai, and encova-workspace on Vercel Hobby. All nine hosted migrations and database/Auth/private-storage preflight passed. The deployment is READY at https://encova-workspace.vercel.app; live API/browser and attendance acceptance checks passed. This is a personal testing demo with no billing upgrade.

## Exact next action

Monitored attendance jobs and Operations are deployed. Vercel confirms the daily 00:15 UTC schedule is registered/enabled (around 05:15 Karachi, Hobby hourly precision); its first natural invocation has not yet been observed. Manual protected execution and recovery passed. Resend SMTP is now authenticated and self-test inbox delivery verified; its restricted sender reaches only the owner until a domain is verified. The updated Vercel release is READY; a reset requested through the live form arrived in the owner Gmail INBOX. Controlled synthetic callback/password-change checks passed without changing the owner password. Next remaining work includes a verified sender domain, an unattended mail retry worker, report reminders/cleanup/alerts, privileged MFA, restore and remaining ERP modules. Full company production acceptance remains incomplete.

## Current demo password policy

At the owner's explicit request, the personal-demo provider and matching application forms/services now accept passwords of at least 8 characters. The live owner password was changed privately and API/browser sign-in, old-password rejection, mobile access and sign-out passed. Company policy should be reviewed before staff rollout; the owner intends to change the demo password at project completion. No password is recorded in this report.
