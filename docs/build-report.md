# Encova Workspace — delivery report

Date: 11 November 2026 (Asia/Karachi)
Repository: https://github.com/TalhanAhmad/ERP-SYSTEM

## Delivery status

The specification has been analyzed and a real Next.js/PostgreSQL implementation has been created from an empty directory. The authorized implementation has expanded across core management, reports/learning, calendar, tables/import/export and security/recovery. Learning milestones and company rollout are not inferred from feature delivery. A personal testing demo is deployed on Vercel with Supabase. Company production acceptance, real-data migration, pilot acceptance and learning completion remain outstanding.

Talha authorized building across milestones and committing/pushing to the supplied repository. The document's daily advancement restriction is superseded by that direct authorization. The commit author email is the value supplied by Talha; the repository-local author name is Talha Ahmad.

## Implemented

- Strict TypeScript, App Router, exact dependency lockfile, Prisma/PostgreSQL migrations, startup environment validation and server-only boundaries.
- Better Auth database sessions, disabled public sign-up, verified emailed invitation acceptance and transactional admin bootstrap.
- Scoped project membership, stable-ID task assignment, guarded assignee transitions, immutable numbered submissions, independent review, changes/resubmission/approval and version conflicts.
- Atomic audit/notifications, stored idempotency results, bounded transaction retries, same-origin/CSRF checks and database-backed mutation limits.
- Schedule policies/assignments, schedule snapshots, server-timestamped check events, effective attendance summaries and preserved raw history.
- Full-day leave reservations, independent decisions and shared date locks with check-in; corrections retain raw events and reject stale versions.
- Daily draft/submission/acknowledgement/return services and screens; private report snapshots retained on return.
- Initial workspace/dashboard, people/invitation, projects, work detail/review, attendance, schedules, leave, corrections, reports, notifications and audit screens; password-reset forms.
- Role/deactivation service endpoints, session revocation and a serialized last-super-admin guard.
- Email outbox leasing/retry, attendance reconciliation commands, synthetic fixtures and CI configuration.

## Supabase/Vercel foundation update

Talha selected Supabase PostgreSQL/Auth/Storage and Vercel. The application retains its Next.js/Prisma service architecture. Added provider-aware server authentication, HTTP-only Supabase SSR session refresh, controlled identity-provisioning leases/retries, a separate Supabase admin bootstrap, pooled runtime/direct migration connections, strict hosted-environment guards, Tailwind's build pipeline, private-access SQL and a bounded authenticated job endpoint.

The existing local administrator and Better Auth records are preserved for local compatibility; Vercel deployments reject that auth provider. Supabase identities are linked explicitly using a separate UUID field. Actual production accounts/passwords are not migrated automatically. Browser forms use shared server account endpoints, so the UI does not need a rewrite at cutover.

The hosted encova-private Storage bucket is private; task-submission upload/download and revision records/UI now work with a 4 MiB app cap. Larger/resumable uploads, retention/orphan tooling and broader production acceptance remain outstanding. Official CLI browser authentication resolved the connected-tool access gap. Created a separate Encova Solutions Supabase organization, Encova Workspace Demo database in Mumbai and encova-workspace on Vercel Hobby for the authorized personal demo. Applied all ten real database migrations, restricted runtime access, RLS, closed signup and exact Auth callbacks. Deployed the Next.js frontend and backend together at https://encova-workspace.vercel.app. SMTP delivery, privileged MFA, recurring scheduling and backup restore remain company launch gates. See docs/operations/deployment.md.

## Verification and limits

The latest complete batch is recorded below and in docs/testing/results.md; final table/security verification is complete. Earlier regression: 121 unit, 126 integration and 13 browser tests passed, plus strict typing, lint, normal/Supabase-mode builds, fresh migrations and dependency checks. Exact results are maintained in docs/testing/results.md. Unit checks cover strict schemas, legal task transitions, independent review, Karachi midnight boundaries, CSV-cell sanitization and attendance classification. PostgreSQL checks cover transactions, locking/races, retries, immutable work history, invitation-only identity, role isolation, leave conflicts, corrections, reports and outbox recovery. Browser checks use independent accounts and a production-mode server.

Passing tests cover implemented behavior. Organization/profile/lifecycle/calendar and reports/internships/maintenance are deployed. Tables/import/export, optional MFA/session controls, activity pagination and follow-up dashboard links are deployed and live-verified. Isolated restore and bounded synthetic service load are measured. Company sender/domain, owner MFA rollout, policy confirmation, commercial hosting/pilot decisions and hosted backup/Storage recovery remain separate gates. See docs/planning/backlog.md.

## Progress tracking

The live index is docs/progress.md. docs/work-log.md records actions, defects and corrections. All 60 daily records exist under docs/planning/days. The Word report includes the current report, progress, work log, test results and remaining work. Regenerate it after meaningful changes with pnpm report:export.

## Publication

The initial authentication failure is resolved. GitHub CLI browser authorization completed as TalhanAhmad; credentials are stored in the system keyring. Repository ADMIN access was verified. `git push -u origin main` succeeded, and local/remote main were confirmed equal at 396a146d897a1fa9ba2eb7a4131f63d1ee7641c2. The implementation commit remains a7dccbd, followed by documentation commits.

Remote verification passed at https://github.com/TalhanAhmad/ERP-SYSTEM/actions/runs/42384281499 for commit 396a146d897a1fa9ba2eb7a4131f63d1ee7641c2. The clean Ubuntu runner completed installation, client generation, migrations, type checking, lint, unit/integration tests, production build, browser tests and documentation verification. Publication does not indicate that the remaining specification or production acceptance is complete.

The Supabase/Vercel foundation was subsequently committed and pushed as 31e55e4. Remote/local SHA equality was verified and all GitHub Actions checks passed in run 42403511665, including the explicitly selected Supabase production build. Evidence: https://github.com/TalhanAhmad/ERP-SYSTEM/actions/runs/42403511665. This does not verify a hosted Supabase project or a Vercel deployment.

## Live demo deployment — 8 November 2026

Vercel deployment dpl_AUKDCBEMeQWL9ncTxyv7oi5cidUA reached READY at https://encova-workspace.vercel.app. Node 24 functions run in Mumbai alongside the Supabase ap-south-1 project. The app uses real Supabase Auth and a pooled PostgreSQL runtime login; owner migration credentials are absent from Vercel. The first super admin belongs to the authenticated account owner. Credentials are shared privately and excluded from this report.

The hosted preflight passed closed signup, restricted role, RLS on application tables, private bucket and verified client TLS. Optional DATABASE_SSL_CA supports the official provider trust root without disabling certificate or hostname verification. This is a personal demo on Hobby, with no paid-plan upgrade. Detailed live checks and publication evidence follow in docs/testing/results.md and docs/work-log.md.

Deployment source/report committed and pushed as 9d5a0ccf69a714a19221941e269a5e04fc9a7de7; local and remote main matched. All 147 local automated tests and 16 live checks passed. GitHub Actions run 42407530523 passed all clean-runner checks, including migrations, typecheck, lint, unit/integration/browser tests, normal and Supabase-mode builds and documentation verification.

## Sidebar and invitation-management milestone

Implemented scrollable desktop navigation with reachable account controls, mobile account/sign-out controls, administrator invitation list/actions, HR member-only scope, safe versioned resend/revoke, fresh-token replacement, queue cancellation, provisioning race protection and explicit email queue status. Added the seventh additive migration linking outbox mail to invitation history. Worker/serverless paths now share validated SMTP transport and attendance processing can proceed without SMTP. All 171 local automated tests passed. Source commit 8769b9b passed GitHub Actions run 42411734232. Seven hosted migrations are applied and Vercel deployment dpl_EakZQrEvDeTwUFQpQnfjA8dzotoK is READY at the canonical live URL; final live evidence follows in the testing results.

No email service is configured, as confirmed by Talha. The UI explicitly reports that invitations remain queued. No provider account, paid plan or real-recipient test email was created or sent.

Live milestone acceptance passed 27 checks: invitation management/token/identity behavior, safe DTOs, missing-SMTP job processing, existing work/attendance permissions and desktop/mobile navigation/sign-out. The synthetic member was deactivated after testing. The sidebar issue is resolved in the live demo. Full ERP and company production acceptance remain incomplete.

## Private attachment milestone

Implemented assignee draft upload/removal, selectable files per immutable submission revision, private authenticated downloads, safe metadata DTOs and the eighth additive migration. Initial supported formats are PDF/PNG/JPEG/UTF-8 text up to 4 MiB; the bucket's higher limit does not override this app cap. Authorization is rechecked after Storage I/O. Supabase writes occur outside database transactions; upload/deletion retries preserve domain state and never overwrite existing file bytes.

Local verification passed 202 automated tests (117 unit, 78 integration, 7 browser), typing/lint and the production build. Tests include real SDK protocol interactions against an isolated fixture. Hosted deployment dpl_8875MGEvjDMFNBnoNgSdWqMCq7Dr is READY, with eight migrations applied. Real-provider acceptance passed twenty file checks and twenty-six other live regression checks (46 total). Source 7f0de97 passed CI run 42467966752. See docs/operations/files.md for limits, access, retry/recovery and explicit release boundaries.

The real 4 MiB object round-tripped with matching digest, and a one-byte-larger upload was rejected. Draft deletion removed the object from the actual bucket. Two submitted revisions retained their own downloadable bytes, including after uploader deactivation; that deactivated account itself was denied. Both synthetic file-test accounts were deactivated and no real employee data or external email was used.

## Monitored attendance milestone

Implemented immutable audience snapshots, atomic per-person cursor checkpoints, claimed attempt history, safe failures and audited resume/retry controls. Added a super-admin-only Operations UI/API, preserved corrected/raw attendance and made manual processing stop after operator revocation. The ninth additive migration protects JobRun/JobAttempt with RLS, server-role grants and terminal-history constraints. Clock-modulo user selection is replaced by actual saved progress.

A Hobby-compatible daily attendance cron is registered and enabled for nominal 05:15 Karachi time (hourly precision). Its first natural invocation remains unobserved at handoff. Daily endpoint email sending is disabled. See docs/operations/jobs.md for scope, retry and throughput/recovery limits. Local type/lint, 117 unit, 89 integration and 8 browser checks passed (214 total), plus the production build. Hosted deployment dpl_D9rTpj8cZ1WCzwphKA3EkwUXeq2g is READY. Source 877addf passed clean-runner CI run 42477410444. Thirteen live Operations checks and forty-six existing workflow checks passed (59 total).

The live tests used an isolated synthetic historical assignment after confirming no other active assigned people were eligible on that date. They simulated an interrupted claim and a processor failure only on newly queued synthetic jobs, then recovered through the live browser/API. No real outage, internet email delivery or natural cron invocation is implied by those tests. Test identities were deactivated; immutable job/attendance evidence was retained.

## Transactional email milestone

Implemented scoped post-commit invitation delivery, Resend deduplication headers, test-recipient enforcement, administrator demo notices and a credential-safe SMTP verifier. A timestamp expiry test exposed a local session time-zone mismatch; application PostgreSQL connections now explicitly use UTC and the real hosted transaction pooler accepts the setting. No live records were rewritten.

Talha selected Resend and confirmed no domain is owned yet. Official CLI authorization and a private send-only key succeeded. Real SMTP self-test acceptance and arrival in the owner's Gmail INBOX are verified. Minimal custom SMTP configuration was applied to Supabase Auth while preserving all unrelated provider settings. Vercel deployment dpl_H4vyzvankZvxXRABivHg8Z9nk3vc is READY, and the live forgot-password request arrived in the owner Gmail INBOX. A separately generated recovery token completed the callback/form/password change for a disabled synthetic member while preserving its access denial and the owner password. All 71 live checks passed; source 4d76a19 passed CI 42481163707. The default sender remains restricted to the owner's email; full employee invitations/reset delivery require a verified domain. See docs/operations/email.md.

## Owner-requested personal-demo password policy

The owner requested a shorter administrator password after the provider rejected it under the former minimum. The current demo policy is aligned to 8 characters across Supabase, browser forms, server validation, local compatibility and bootstrap tools. The actual password is stored only in private deployment files, never in this report or source. Boundary and browser acceptance checks cover the shorter policy; source 088a714 is deployed as dpl_4Tp4KQSx349F8kApPNLpNAdPvbRU. All 224 local tests and five targeted live checks passed; the new owner password works and the old password is rejected. Restore the intended company policy before staff rollout and change the demo credential at project completion as requested by the owner.

## Persistent role demo accounts

Created the three requested live exploration logins through existing invitation/provisioning paths: HR Admin, Team Lead and Member. They remain active, with a Team Lead-managed synthetic project, two Member tasks including one reviewable submission, demo schedules and a pending leave request. All twelve targeted API/permission/browser checks passed. Existing source and deployment were retained; no role permissions were weakened. See docs/operations/demo-accounts.md. Passwords are excluded from source/report.

## Focused HR and shared announcement milestone

Implemented the owner's simplified HR scope with named attendance/check-in status, leave approvals and recipient notifications. Removed HR's unused navigation and direct page/API access. Super Admin can publish/edit/delete one shared plain-text announcement, visible to every signed-in role. Edits renew the 24-hour TTL; open pages remove expired content automatically. Cleanup occurs on the first authenticated read after expiry or the daily scheduled pass. The tenth additive migration preserves existing business records. Source 5155215 passed CI 42487129069 and deployment dpl_FVM6CY46egk1cz1c9pWgG5F3vvUK is READY. All 235 local and 21 targeted hosted checks passed. The three exploration accounts remain active. See docs/operations/announcements-hr.md.

## Super Admin account-management milestone

Implemented searchable/paginated People management, per-account safe profile/history/counts, basic profile editing, role changes, deactivation and linked reactivation. Actions are versioned/idempotent and preserve records; UI confirmations/reasons, self/last-admin protection and root-only page/API boundaries are retained. Login email remains read-only, and HR's focused interface is unchanged. No schema migration is required. Source d7fd89d passed CI 42515443745 and deployment dpl_14WHhC1sBzQ9JnYovXcnK9ewagNW is READY. All 250 automated and 22 hosted checks passed. Existing demo credentials/access were preserved; only the new synthetic verification account was retired. See docs/operations/people-management.md for the exact session/feature limits.

## Dashboard and attendance roles update

Implemented the owner-approved Assignments list/filter/create structure, matching clickable dashboard cards and paginated active/archive Projects. Super Admin attendance is view-only at both UI and punch-service boundaries; new schedules and automatic absence jobs exclude Super Admin. HR, Team Lead and Member use the shared personal attendance panel. Root and HR see named staff status with date/status/name filters, and HR keeps its focused navigation and leave approvals. Existing business/history records are retained and no migration is required. All 260 local automated checks and build passed. Source ca49e9feddbc35a8c6ed3069b6a2249693c4dc03 passed CI 42606060629 and Vercel deployment dpl_FyaWEkk2TToL7vZZ2GykwmctheTC is READY. All 24 hosted checks passed, including actual role punches, live card/list equality, task form creation, mobile layout and controlled fixture cleanup. Existing owner/exploration credentials remain unchanged. See [operations](operations/assignments-attendance.md).

## Completion pass: calendar, work lifecycle and organization

Implemented prospective schedule replacement, holiday management, immutable-history and leave guards, clearer validation/weekday forms; project detail/edit/archive/restore and protected member removal; task editing/reassignment/cancel/reopen/independent return and immutable comments; department/team/employment administration with manager-cycle protection and private-contact redaction; and versioned configurable company settings labeled as demo policies. Thirteen additive migrations now apply locally. HR remains focused and Super Admin attendance remains view-only.

All 281 local automated checks passed (121 unit, 144 integration, 16 Chromium), plus typing/lint and production build. New lifecycle action forms reset after state changes. Controls wait for client readiness; browser tests explicitly await client navigation. Source 78a03c5 passed CI 42639937002, thirteen hosted migrations/preflight passed, and Vercel dpl_5Vhvx3dZw61j8UNvMTfpYmrfbBzx is READY. All 18 hosted acceptance checks passed. This is an intermediate batch of the owner-authorized completion pass; reports/automation and remaining modules continue.

## Completion pass: reports, internships and maintenance

Implemented scoped daily reports with task links, immutable submitted versions, cutoff/late snapshots, reasoned independent review and calendar-aware missing status; personal notification preferences/read-all; durable reminder/expiry maintenance with retry monitoring; and bounded unattended permitted email retry. Implemented internships, one-active enrollment, mentor-scoped learning plans, intern evidence submission, approved-work completion, private weekly feedback and explained Root overrides. Current HR scope excludes reports/internships and report reminders.

All 300 automated checks, build and typing/lint passed. Fifteen hosted migrations and preflight passed. Source 60c1d3d passed CI 42661510686 and Vercel dpl_5ynWvZVcp16XqE1dN7jWkHDPTCZQ is READY. All 20 targeted hosted checks passed. Advanced table/import/export, privileged security capability and release evidence remain. An owned email domain and actual company policy/pilot approval remain external dependencies.

## Final implementation pass — 10 November 2026

Added scoped structured tables, personal views/columns, keyboard navigation, versioned inline edits, atomic bulk previews and CSV import/export; immutable attendance detail/correction decisions; Root manager transfer; private activity pagination and matching follow-up links. Migrations sixteen/seventeen add preview/view storage, correction reasons, a strong explained-rating constraint, registered Supabase app sessions and optional privileged MFA policy. Role/status changes now invalidate old hosted app sessions. The report editor saves current input before submitting, with a provider-latency regression test. Owner and persistent exploration credentials remain unchanged.

Recovery/load and security limitations are documented in operations/tables-security-recovery.md. Existing users will sign in again after the session-registry cutover; no passwords are migrated or reset. The company-wide MFA requirement remains disabled, and restricted email delivery is preserved. Final source baf7d10 passed CI 42809226350 and 324 automated tests; migrations sixteen/seventeen and Vercel dpl_9d8mcA3q8ei1LsPNMqahrFAB4mcA are deployed. All 56 final hosted checks passed, including real TOTP/global logout and private Storage, plus the protected prior-app compatibility rehearsal.

## Authorized readiness follow-up — 11 November 2026

Added a verified own login-email request with password reauthentication in a separate temporary provider session, existing MFA/current-session checks, provider dual-inbox confirmation and atomic same-Person synchronization. Other app sessions are revoked only after the provider confirms the final address; work/identity IDs remain unchanged. Callback/status screens keep redirects internal. No password or email token is stored in audits/receipts. Security forms are disabled before hydration and during refresh, and use POST semantics. The capability remains disabled under restricted email delivery; actual employee inbox acceptance awaits a domain.

The hosted-source recovery tool now uses a consistent read-only ERP snapshot, verified pooler TLS, a strictly local restore destination and a new private test bucket. It compares all public table content/counts/constraints and every restored object hash against the available attachment records. Completed: 47 tables, 1,593 rows, 185 constraints, 9 private objects/333 bytes, all 9 attached records verified, 30.141 seconds. Source ERP records and original objects were not written; the owned restore bucket was removed. Auth identity recovery, managed PITR and off-site backup are separate decisions. Latest local verification is 331 tests (131/179/21), plus typing/lint/build; CI/live publication evidence is appended after execution.
