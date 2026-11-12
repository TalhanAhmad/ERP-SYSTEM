# Verification results

Date: 10 November 2026, Asia/Karachi. Environment: macOS ARM64, Node 24.22.2, pnpm 12.18.0, real PostgreSQL 17.9 on loopback. All test accounts and work data are synthetic. Development, test and restore databases are distinct.

## Latest outcomes

| Command / check | Outcome | Evidence and scope |
| --- | --- | --- |
| pnpm install / peers check | PASS | Exact lockfile resolved; no peer dependency issues. |
| pnpm exec prisma validate | PASS | Initial schema validated; subsequent migrations and generated client succeeded. |
| pnpm db:migrate:deploy on dev/test | PASS | Seventeen migrations, including reviewed SQL integrity constraints, applied to separate databases. Test database was recreated locally to validate a clean migration sequence. |
| pnpm typecheck | PASS | Strict TypeScript, application/services and test sources. |
| pnpm lint | PASS | No lint errors in latest check. |
| pnpm test:unit | PASS — 131 tests | Task transitions, schemas/unknown fields/URLs, independent review, Karachi midnight, CSV sanitization, attendance summaries and overnight rejection. |
| pnpm test:integration | PASS — 179 tests | Real PostgreSQL transactions, concurrent versions/submissions/reviews, rollback, scope, invitations, signup bypass denial, active/unlinked users, last-admin guard, session revocation, attendance/leave race, corrections, report immutability and worker leases/retry/recovery. |
| pnpm build | PASS | Production compilation, TypeScript and page generation; includes password reset screens and all implemented pages. |
| pnpm test:e2e | PASS — 21 browser tests | Separate role contexts; project/membership/task creation, start, submit, return, resubmit, approval, immutable revision visibility and unauthorized URL denial. A 360px dashboard/work check also passes. Latest readiness run: 1.4 minutes on port 3100; local app on 3000 remained available. |
| pnpm audit --prod --json | PASS | Registry audit reported 0 info/low/moderate/high/critical vulnerabilities. This is not a general security certification. |
| pnpm verify:docs | PASS | Required documents, 60 milestone records and local links validated. |
| DOCX export integrity | PASS | ZIP/XML validation and macOS textutil conversion both succeeded; the Word report is readable. |
| Git commit/push | PASS | Latest application source fcb7bc71a453eb59e1c645b07e8ee997814d52db passed CI 42976770350 and is live as dpl_2SSKGD2xS2jojkBuHhoqN6xjLCa4; final evidence/report committed separately. |

## Supabase/Vercel foundation verification

Current milestone local results: 121 unit, 126 integration and 13 browser tests passed (260 total); typecheck and lint passed. The six migrations applied cleanly both as an upgrade and into the separate empty encova_restore database. That database name does not constitute a backup-restore demonstration.

Supabase SDK + real PostgreSQL contract tests verify safe session DTOs/HTTP-only cookies, server identity verification, client role metadata rejection, immediate domain deactivation denial, legacy endpoint closure, same-origin protection, generic reset results, internal-only redirects, sign-out cookie clearing and scheduler authentication. Provider HTTP is simulated in these tests; no live Supabase result is claimed. Separate PostgreSQL tests cover provisioning failure/retry/revocation/concurrency, RLS/grants and the bounded job pass.

Both a normal build and a Supabase-selected Vercel-mode build passed. The latter used configuration fixtures/reserved example URLs and did not contact a real hosted project. The same production artifact passed the existing local compatibility browser journey after synthetic account preparation. Production dependency audit again reported no known vulnerabilities and no peer dependency conflicts.

A browser rerun initially failed because integration tests reset the shared test database and the fixture-preparation step was omitted. Recreating the synthetic accounts before rerunning resolved it. The CI workflow already prepares accounts between these phases and now also compiles the Supabase configuration explicitly.

The real Supabase/Vercel demo deployment, migrations, hosted identity sessions, restricted pooled database access and preflight have now been verified through authenticated official CLIs and live browser/API checks. Provider SMTP delivery, binary storage upload/download, recurring scheduler, privileged MFA rollout and backup restore remain unverified. Earlier connected-tool access failures were resolved through official CLI browser login.

## Remote verification

Deployment source/report commit 9d5a0ccf69a714a19221941e269a5e04fc9a7de7 was pushed and remote/local SHA equality verified. CI run https://github.com/TalhanAhmad/ERP-SYSTEM/actions/runs/42407530523 passed all configured checks, including browser E2E and the Supabase-mode build. All local 147 automated tests and the 16 live checks passed.

Earlier foundation evidence: Supabase/Vercel foundation commit 31e55e48da139c7012e6c64d583eb6922a591b4d passed GitHub Actions run 42403511665: https://github.com/TalhanAhmad/ERP-SYSTEM/actions/runs/42403511665. All configured checks passed on the clean Ubuntu runner, including the new Supabase-mode production build. This remains a build/contract verification, not live-provider acceptance.

Historical initial-publication evidence follows.

GitHub Actions run 42384281499 completed successfully for commit 396a146d897a1fa9ba2eb7a4131f63d1ee7641c2. Every configured step passed, including browser E2E and documentation verification. No application code changed during authentication/publication; this report update is documentation only.

## Defects found and corrected

1. Missing initial Node/pnpm/PostgreSQL tooling: recovered through isolated Node and embedded local PostgreSQL.
2. Unsupported Prisma 8 release-candidate default: pinned compatible Prisma 7.10.1.
3. Vitest's unavailable describe.sequential helper: corrected suite API usage.
4. Raw-query serialization errors bypassed the retry branch: handled structured PostgreSQL codes and retested concurrent duplicates.
5. Advisory locks returned PostgreSQL void values Prisma could not deserialize: cast return values to text.
6. A two-character HR fixture violated the new username CHECK: corrected the fixture rather than weakening validation.
7. Database-clock leases had sub-millisecond precision that did not match JavaScript Date ownership checks: normalized lease timestamps and verified worker completion/retry/recovery.
8. One browser phase overlapped an integration reset: subsequent database-dependent phases run sequentially.
9. Select locators were brittle around nested labels: switched browser checks to role/name locators.
10. A task URL was captured before client navigation completed: explicitly wait for the detail URL.
11. A table's minimum content width overflowed mobile layout: constrained panel/table width; verified 360px after real task data existed.
12. External font loading stalled page load: removed the remote font import and verified the browser journey without that dependency.
13. Multiple synthetic browser accounts hit the real auth login limit from loopback: test retries respect the short rate-limit window; production limits were preserved.

## Known limitations and unverified gates

- PostgreSQL's pg adapter emits a deprecation warning about concurrent client.query use during relation queries. Tests pass on pinned pg 8.23.1; investigate before a future pg 9 upgrade.
- Browser coverage is the work lifecycle and mobile shell; it is not the complete specification's attendance/leave/internship/pilot journey or a comprehensive accessibility audit.
- Email send callbacks, outbox leases and retries are tested; actual SMTP transport delivery is not demonstrated.
- Attendance finalization/reconciliation code exists; privileged manual retry auditing, job-run monitoring, reminder scheduling and broad recovery tests remain open.
- No real company records, privileged MFA rollout, performance baseline, backup restore or incident drill were tested. Hosted migrations and the personal-demo host are verified below.
- Organization, internship, advanced tables/import/export and remaining lifecycle requirements are listed in the backlog. They are not counted as passed.
- GitHub CI passed on the clean Ubuntu runner for published commit 396a146; evidence: https://github.com/TalhanAhmad/ERP-SYSTEM/actions/runs/42384281499. This verifies the implemented application, not the unfinished pilot gates.

## Live demo acceptance — 8 November 2026

Canonical URL: https://encova-workspace.vercel.app. Deployment dpl_AUKDCBEMeQWL9ncTxyv7oi5cidUA reached READY with the Next.js frontend and Node backend on Vercel, Supabase Auth, restricted pooled PostgreSQL and prepared private Storage. Vercel Hobby is authorized for personal testing; no billing upgrade was made.

Hosted preflight passed: closed signup, restricted non-superuser/non-bypass runtime role, application RLS, private bucket and certificate-authorized client TLS. All six migrations applied through the controlled session pooler. Local checks passed: typecheck, lint, 93 unit, 52 integration, 2 browser tests and production build. The extra five unit checks cover custom-CA SSL option preservation and bounded pools. Browser fixtures were explicitly scoped to encova_test after the preparation guard correctly rejected the dev target.

Live checks use only synthetic test records and the authenticated account owner's bootstrap login. No invitation email was sent. Results:

| Live check | Outcome |
| --- | --- |
| Public login page | PASS |
| Anonymous API access rejected | PASS |
| Unauthenticated job invocation rejected | PASS |
| Cross-origin sign-in rejected | PASS |
| Real Supabase owner sign-in and SUPER_ADMIN domain permissions | PASS |
| Separate real Supabase MEMBER sign-in | PASS |
| MEMBER project creation and audit access denied | PASS |
| Hosted project persistence and idempotent retry | PASS |
| Self-approval rejected on live backend | PASS |
| Live task assignment, start, submission and independent approval | PASS |
| Live attendance schedule, check-in and check-out persistence | PASS |
| Live browser login and authenticated dashboard | PASS |
| Live browser renders persisted approved task | PASS |
| Live 360px dashboard layout | PASS |
| Live sign-out clears application access | PASS |
| Synthetic member deactivated; existing hosted session denied immediately | PASS |

The synthetic member was deactivated through the live admin API after verification; its existing session was immediately denied. Synthetic project, approved task, attendance and immutable audit evidence remain clearly labeled in the demo. No real employee records were imported. SMTP invitation delivery, password-reset delivery, binary upload/download, automatic job scheduling and company production readiness are not claimed.

Additional live asset check passed: none of the configured database credentials, server key, cron secret or generated admin password appeared in public login HTML or its 10 JavaScript assets. This is a targeted credential-exposure check, not a comprehensive security audit.

## Live login recheck after user report — 8 November 2026

A supplied screenshot showed generic credential rejection. The stored live-owner credentials were independently verified again: POST /api/session/sign-in returned 200, GET /api/v1/me returned 200 with SUPER_ADMIN, and a fresh Chromium login rendered the authenticated dashboard. The screenshot does not reveal the entered password, so its exact cause is not established. No account password reset or application change was necessary; hosted credentials are separate from the local account and excluded from this report.

Supplementary limitation from that diagnostic: the Sign out button was outside the default Chromium viewport and its click timed out after the successful dashboard assertion. API sign-out passed. Track sidebar control reachability as a separate UI follow-up; this diagnostic does not claim browser sign-out passed.

## Sidebar and invitation-management milestone — 8 November 2026

Local verification: typecheck/lint, 100 unit tests, 65 integration tests and 6 Chromium browser tests passed (171 total), Prisma validation and normal production build passed, and production dependency audit reported no known vulnerabilities. Seven additive migrations are applied locally and to encova_test. Seven migrations are also applied to Supabase, and the runtime preflight passed. Vercel deployment dpl_EakZQrEvDeTwUFQpQnfjA8dzotoK is READY. Source commit 8769b9beb0113d608865879cb06a35047479b16a passed all clean-runner checks in https://github.com/TalhanAhmad/ERP-SYSTEM/actions/runs/42411734232.

New checks cover administrator/HR/member permissions, private invitation DTOs, token rotation and replay rejection for both auth paths, expiry, retry idempotency, stale/concurrent management requests, revocation during provider provisioning and HTTP origin/session/version validation. Loopback SMTP tests complete a real SMTP conversation and exercise recipient rejection/retry without external mail. Missing SMTP leaves queued mail untouched while attendance processing continues. Chromium verifies the actual People controls and invitation links, plus administrator navigation/sign-out at 1280x720, 1280x480 and 360x800.

The first invitation browser run encountered Next.js's extra route-announcer alert; scoped its locator to the form and matched the existing lowercase status labels. All six browser checks then passed. The earlier supplementary sidebar limitation is fixed in the deployed source; live viewport acceptance is being recorded below. Read-only schema comparison retains the pre-existing reviewed SQL-only constraints, which are intentionally absent from Prisma's model; no constraint-removal script was executed.

Talha confirmed no email service exists. Local SMTP acceptance is not proof of internet delivery or inbox receipt. Live invitation delivery, verified sender setup and scheduler operation remain unclaimed.

## Live milestone acceptance

All 27 checks below passed against https://encova-workspace.vercel.app after deployment dpl_EakZQrEvDeTwUFQpQnfjA8dzotoK. The invitation acceptance fixture read synthetic queue tokens privately to exercise the provider/application path; no internet email delivery is implied. The generated MEMBER account was deactivated afterward and its existing session was denied. Clearly labeled synthetic invitation/project/task/attendance records and immutable audit history are retained.

| Live check | Outcome |
| --- | --- |
| Hosted invitation resend is idempotent and stale management is rejected | PASS |
| Hosted rotated invitation token is rejected before provisioning | PASS |
| Hosted resend cancels the previous queued email | PASS |
| Hosted revoked invitation cannot create an account | PASS |
| Hosted replacement invitation provisions a real Supabase identity and ACTIVE MEMBER | PASS |
| Hosted accepted invitation cannot be reused | PASS |
| Hosted invitation DTO excludes tokens, email bodies and provisioning IDs | PASS |
| Hosted authenticated job pass runs without SMTP and does not claim email delivery | PASS |
| Public login page | PASS |
| Anonymous API access rejected | PASS |
| Unauthenticated job invocation rejected | PASS |
| Cross-origin sign-in rejected | PASS |
| Real Supabase owner sign-in and SUPER_ADMIN domain permissions | PASS |
| Separate real Supabase MEMBER sign-in | PASS |
| MEMBER project creation and audit access denied | PASS |
| Hosted project persistence and idempotent retry | PASS |
| Self-approval rejected on live backend | PASS |
| Live task assignment, start, submission and independent approval | PASS |
| Live attendance schedule, check-in and check-out persistence | PASS |
| Live browser login and authenticated dashboard | PASS |
| Live browser renders persisted approved task | PASS |
| Live 360px dashboard layout | PASS |
| Live sign-out clears application access | PASS |
| Synthetic member deactivated; existing hosted session denied immediately | PASS |
| Live administrator navigation, invitation queue notice and sign-out at 1280x720 | PASS |
| Live administrator navigation, invitation queue notice and sign-out at 1280x480 | PASS |
| Live administrator navigation, invitation queue notice and sign-out at 360x800 | PASS |

Live administrator account controls were additionally inspected in a short-desktop screenshot. The original sidebar Sign out reachability limitation is resolved on the deployed app at all three tested viewport sizes. This covers implemented behavior, not the full ERP specification, production performance, provider inbox/reset delivery or a backup restore. No recurring schedule is enabled; the job check was an authenticated manual invocation.

## Private attachment milestone — local verification

117 unit, 78 integration and 7 browser tests passed (202 total), plus strict typecheck/lint and normal production build. New checks cover MIME/signature/UTF-8/name/size validation, safe disposition headers, metadata boundaries, real SDK upload/download/deletion against isolated loopback HTTP, ambiguous-write recovery, mismatch rejection, concurrent claim isolation, provider calls outside DB transactions, scope/deactivation/membership denial, failed-removal recovery, quotas and immutable/matching submission history. Browser coverage adds real file controls, revision downloads, lost-response retry without duplication and removal. Existing invitation/work/sidebar/mobile browser journeys still pass.

The eighth migration applied to encova_test. The hosted eighth migration and runtime preflight passed; the real bucket transfer and boundary results are recorded below. Documented local fixtures are not a production file backend.

## Private attachments — live acceptance

Deployment dpl_8875MGEvjDMFNBnoNgSdWqMCq7Dr is READY at https://encova-workspace.vercel.app. Source commit 7f0de97b41016059e1c30a96df2c9f6ba2c5e9e2 passed all clean-runner checks: https://github.com/TalhanAhmad/ERP-SYSTEM/actions/runs/42467966752. The private bucket remains private, and the eighth migration protects the new table with RLS and restricted-role grants.

All twenty file checks below passed with the real provider, including a mobile browser and an exact 4 MiB round trip. No real employee data or external emails were used. An additional eight invitation/job checks, fifteen existing core workflow/auth/attendance checks and three live layout/sign-out checks passed on this same deployment (46 total). Both synthetic file-test identities were deactivated and the owner account was preserved.

| Live file check | Result |
| --- | --- |
| Live private upload and idempotent replay preserve one file | PASS |
| Live upload key reuse with changed bytes is rejected | PASS |
| Draft download denies other project members, outsiders and anonymous callers | PASS |
| Live file upload denies a non-member | PASS |
| Live MIME/signature mismatch is rejected | PASS |
| Live 4 MiB plus one byte upload is rejected | PASS |
| Exact 4 MiB file uploads/downloads through Vercel and Supabase with matching digest | PASS |
| Live draft removal prevents further app download | PASS |
| Removed draft object is absent from the real private bucket | PASS |
| PDF-header, real PNG and real JPEG fixtures pass allowed-type transfer and draft cleanup | PASS |
| Designated reviewer downloads submitted bytes with safe filename/cache headers | PASS |
| Submitted attachment remains inaccessible to a project outsider | PASS |
| Direct anonymous public-bucket URL cannot serve the private object | PASS |
| Live task metadata excludes object paths and file digests | PASS |
| Submitted file cannot be removed after changes are requested | PASS |
| Live mobile browser uploads, selects and submits a private revision file | PASS |
| Live approval retains download links for both immutable revisions | PASS |
| Actual browser download preserves the original filename and bytes | PASS |
| Deactivation denies an existing session access to the private attachment | PASS |
| Authorized reviewer retains historical file access after uploader deactivation | PASS |

The exact-boundary draft and MIME fixtures were physically removed after testing. Two small submitted revision files remain as immutable synthetic history. The short/mobile screenshot was inspected, and the local preview was restarted to load the regenerated client; /login returned HTTP 200. Larger/resumable transfer, malware scanning/full format parsing, retention/orphan dashboards, SMTP/reset delivery, recurring scheduling, MFA and restore remain outside this acceptance.

## Monitored attendance milestone — local checkpoint

Typecheck/lint, 117 unit tests and 89 integration tests passed, including a 100-person active assigned audience, partial cursor resume, no-op request replay, atomic failure rollback, safe errors, competing claims, expired-lease abandonment, stale worker/role denial, corrected/raw-history preservation, schedule-date uniqueness and terminal-history protection. Real PostgreSQL is used; no production employee records are test fixtures.

Repeated test runs initially captured previous active job.p fixtures in the dedicated test database. Retiring only this suite's old synthetic people fixed isolation; production audience filters were not narrowed. Reusing an already completed scheduled date was separated from testing terminal history. Initial compiler/lint findings corrected nullable system audit actors, Prisma selection typing and render-time clock work. Operations browser assertions were refined to distinguish job badges from attempt status/reason markup; the remaining seven existing browser tests passed throughout. Final browser/hosted evidence follows after rollout.

## Monitored attendance — final verification

Local results: 117 unit, 89 integration and 8 browser tests passed (214 total), plus typing/lint, production build, Prisma validation and docs checks. Source 877addfff349d5aae5561713310baed860d9712b passed all clean-runner checks at https://github.com/TalhanAhmad/ERP-SYSTEM/actions/runs/42477410444. The ninth hosted migration and runtime role/RLS/private-bucket/verified-TLS preflight passed. Vercel deployment dpl_D9rTpj8cZ1WCzwphKA3EkwUXeq2g is READY at the canonical live URL.

All thirteen new live Operations checks below passed. The existing eight invitation/job, fifteen core auth/work/attendance, twenty file and three layout/sign-out checks also passed on this deployment (59 total). No external mail or real employee records were used; all synthetic identities were deactivated afterward. Recovery tests deliberately staged interrupted/failed attempts through controlled internal helpers only on freshly created synthetic records, then exercised the actual live retry UI/API.

| Live Operations check | Result |
| --- | --- |
| Live Operations monitoring rejects anonymous and MEMBER sessions | PASS |
| Live mobile Operations UI queues and completes a captured one-person job | PASS |
| Real attendance ledger is reconciled without fabricating raw check events | PASS |
| Live job execution enforces role and matching Origin | PASS |
| Live expired claim is visible and resumes with retained ABANDONED history | PASS |
| Controlled hosted failure records a safe code without private exception text | PASS |
| Live browser retry completes failed work while preserving the failed attempt | PASS |
| Live partial progress resumes and repeated HTTP request does not create a second attempt | PASS |
| Live stale versions and future dates are rejected | PASS |
| Live operational DTO excludes audiences, retry keys and lease internals | PASS |
| Hosted database prevents rewriting finished attempt history | PASS |
| Repeated reconciliation preserves an unchanged attendance snapshot | PASS |
| Live Operations layout and retry controls remain usable at 360px | PASS |

Vercel project metadata confirms one definition for /api/internal/jobs at 15 0 * * *, enabledAt set, disabledAt null and the current deployment ID. This verifies registration/enabled state, not actual timed delivery. The natural automatic invocation marker is still empty; wait for the first daily window and inspect Operations/provider logs. Manual protected invocations are classified Service/CLI, not Schedule. No billing upgrade was made. Daily endpoint email sending is disabled even if SMTP credentials are later supplied; mail worker setup/acceptance is separate.

Anonymous navigation to /operations redirected to /login. Production dependency audit reported no known vulnerabilities. The local preview was restarted after client regeneration, preserving local database/session data. Full company throughput, automatic first-run observation, alerts, historical gap detection, real mail/MFA and restore remain unverified.

## Transactional email milestone — local and provider transport

118 unit, 95 integration and 8 Chromium tests passed (221 total), plus strict typecheck/lint and production build. SMTP tests use a real loopback protocol server; the actual HTTP invitation mutation sends after commit, an idempotent replay does not send twice, rejection remains durably queued, unrelated messages are untouched, expired invitations are skipped and test-recipient restrictions are enforced before SMTP. Connection-only verification emits no mail and redacts failure details.

Initial fixture setup failed because Invitation.invitedBy has a real foreign key; corrected the synthetic inviter fixture. The new short-expiry case then exposed a real local database session time-zone mismatch. Explicit UTC startup options fixed timestamp comparisons; all suites passed after the fix, and the actual Supabase pooled connection accepted the option.

Real Resend TLS/authentication and one owner-only self-test passed. Gmail search confirmed the requested test in INBOX. Supabase SMTP-only push/diff passed with other Auth/database/storage settings unchanged. Vercel release and actual owner reset inbox delivery are now verified below. This restricted sender cannot deliver employee invitations or arbitrary staff reset mail; company acceptance remains incomplete.

## Transactional email milestone — deployed acceptance

Source 4d76a19952f82abea5ad49f3650af14dc6103d50 is pushed to main. [GitHub Actions run 42481163707](https://github.com/TalhanAhmad/ERP-SYSTEM/actions/runs/42481163707) passed all steps, including both production builds, fresh migrations, 221 tests and documentation checks. Vercel deployment dpl_H4vyzvankZvxXRABivHg8Z9nk3vc is READY at https://encova-workspace.vercel.app. No schema migration was required for this milestone.

All 59 existing named live checks passed again (8 invitations/jobs, 15 core auth/work/attendance, 20 private-file, 3 layout/sign-out and 13 Operations), alongside these 12 email checks: 71 named live checks total. Synthetic identities were deactivated, real employee data was not used, and the owner's credentials were preserved. The first natural cron attempt is still not observed.

| Live email check | Result |
| --- | --- |
| People reports restricted sender without claiming employee delivery | PASS |
| Operations shows complete SMTP settings and the demo restriction | PASS |
| Restriction notice is usable at 360px | PASS |
| Password reset rejects foreign Origin | PASS |
| Password reset rejects unknown input fields | PASS |
| Actual forgot-password form calls the hosted backend with a neutral success state | PASS |
| Missing-account reset response matches owner response | PASS |
| Existing owner credentials and SUPER_ADMIN access still work | PASS |
| Login HTML and JavaScript contain no SMTP key | PASS |
| Actual live Supabase reset email arrived in the owner's Gmail INBOX | PASS |
| Separately generated synthetic recovery token completes real callback, form and password change; new credentials verified at Supabase | PASS |
| Synthetic password recovery does not reactivate its disabled domain account | PASS |

The real SMTP self-test also arrived in the owner INBOX. Its separate connection/authentication test sent no message. The recovery mutation used a controlled provider-generated token for an already disabled synthetic member; it did not consume the owner's emailed recovery link or change the owner password. Full invitation/reset inbox acceptance for staff remains dependent on a verified domain.

An obsolete cleanup step initially tried to sign in the member after the file suite had already deactivated it and correctly received 401. Corrected the private test orchestration, verified the identities remained inactive, then completed layout/Operations checks. This was a test-sequence correction, not an application access change. The mobile Operations screenshot was inspected. Local preview was refreshed at http://127.0.0.1:3000; local and live /login returned 200.

## Owner-requested demo password change

Source 088a7147f41f5eedaea2a92462678f9c7dbfc376 aligns the shared personal-demo minimum to 8 across invitation/reset validation, forms, local auth and bootstrap tools. Strict typing/lint, 121 unit, 95 integration and 8 browser tests passed (224 total), plus production build. Boundary tests reject seven characters and accept eight/nine. The browser invitation journey accepts and signs in with an eight-character synthetic password.

Vercel deployment dpl_4Tp4KQSx349F8kApPNLpNAdPvbRU reached READY at the canonical URL. A minimal Supabase config push changed only auth.minimum_password_length from 12 to 8; follow-up diff verified no remaining declared changes and preserved all unrelated provider settings. Updated only the guarded ACTIVE SUPER_ADMIN provider identity and the private deployment credential handoff. No password is committed.

Five targeted live checks passed: new owner API login with SUPER_ADMIN role, old credential rejection, actual browser login/dashboard, 360px layout and browser sign-out/session denial. The previous deployment's 71 live email/work/file/attendance/Operations checks remain historical evidence, not an assertion of a second complete live regression for this password-only release.

[GitHub Actions run 42482165407](https://github.com/TalhanAhmad/ERP-SYSTEM/actions/runs/42482165407) passed all configured checks for source 088a714, including both builds and all 224 tests. The local preview was restarted to load the same shared minimum without changing local account passwords.

## Persistent owner exploration accounts

Data-only setup on the existing deployment passed twelve targeted live checks: three role-correct API logins; Team Lead project and membership; assigned/reviewable work; HR schedules and pending leave; super-admin/privileged-invitation denial; project membership visibility; three actual mobile browser role journeys with sign-out/session denial; and ACTIVE retention of all three requested accounts. These accounts stay available to the owner, unlike retired automated fixtures. No source changes or new full-regression claim accompanies this account setup; the prior 224 automated tests remain the source verification evidence.

The first sample-project setup did not finish; resumed using saved identity state and stable request keys, then completed and verified the expected project/work records. The final Team Lead mobile review screenshot was inspected. No passwords, provider tokens or invitation links appear in committed tracking files.

## Focused HR and shared announcement — local verification

121 unit, 104 integration and 10 Chromium tests passed (235 total), plus typing/lint and production build. The tenth migration applied to isolated dev/test databases. New PostgreSQL/HTTP coverage verifies one shared slot, strict content, Super Admin-only mutations, role-consistent reads, 24-hour TTL and renewed edit expiry, stale IDs/versions, competing admins, idempotent edits, expiry deletion and HR route restrictions/named active people. Browser coverage verifies named check-in/out transitions and leave approval with four HR menus; shared announcement polling, editing, early deletion and timer-driven expiry on an open page also pass. The 24-hour scenario uses a controlled five-second synthetic expiry for the waiting portion, not a claim that 24 wall-clock hours elapsed.

Initial lint found two variables that should be const. The announcement browser flow then exposed a nested textarea label containing its initial message text, causing an exact label lookup to fail after publishing. Explicit field IDs/labels corrected the association; the focused flow and full ten-browser suite passed afterward. Added row locking to keep expiry cleanup from racing an active edit. Hosted migration/deployment/live acceptance are pending at this checkpoint.

## Focused HR and shared announcement — hosted acceptance

Source 5155215215a39c0266545cfd346ad3296917130f passed [GitHub CI 42487129069](https://github.com/TalhanAhmad/ERP-SYSTEM/actions/runs/42487129069), including fresh migrations, both builds and all 235 tests. The tenth hosted migration and runtime/RLS/private-storage/verified-TLS preflight passed. Vercel deployment dpl_FVM6CY46egk1cz1c9pWgG5F3vvUK is READY at https://encova-workspace.vercel.app.

Twenty-one hosted checks passed: four existing owner/demo role logins; anonymous announcement denial; reduced HR APIs; named active-person overview; four-item mobile navigation; direct hidden-page denial; real synthetic check-in and check-out; named leave approval; private recipient notifications; identical announcement/24-hour TTL for all roles; non-admin mutation denial; live edit with renewed TTL and shared Notifications display; stale-edit rejection; 360px usability; early deletion; open-page automatic expiry/database cleanup; and HR browser sign-out/session denial.

The production 24-hour initial/edit TTL was verified from its timestamps. The automatic-expiry wait used an eight-second expiry only on the uniquely identified owned synthetic announcement, which then disappeared without a page reload and was deleted on the next read. Test messages were removed; no owner-created announcement was overwritten. Only the newly created verification member was deactivated. The three persistent exploration accounts and their credentials remain valid. The mobile screenshot was inspected and local/live login pages both returned 200. This milestone adds targeted hosted acceptance, not a claimed rerun of all earlier 71 live cases.

## Super Admin account management — local acceptance

121 unit, 118 integration and 11 Chromium tests passed (250 total), plus typing/lint and production build. Fourteen new integration cases cover root-only safe detail, paginated/filtered search, reserved usernames, normalized profile writes, no-op/replay/stale behavior, concurrent profile/role changes, mutually competing administrator deactivations, linked restoration, retained work, self protection and direct HTTP boundaries. Demoting a Team Lead now removes retained project-manager write rights while preserving membership/history. No schema migration is required.

The browser account journey passed through search, profile editing, role/session changes, inactive filtering, deactivation/reactivation, new sign-in, 360px layout, HR denial and protected owner controls. Initially its row locator matched both the directory and invitation history; scoped it to the named account region. An existing workflow later timed out; its focused unchanged repeat passed. On another full repeat after midnight, the HR test's next day became a configured synthetic holiday and the app correctly rejected the leave. Updated only that fixture to choose a scheduled non-holiday date. The final complete eleven-browser run passed in 45.1 seconds. Hosted release/acceptance are pending at this checkpoint.

## Super Admin account management — hosted acceptance

Source d7fd89dd9a1050fde4e173296cc772fedd05dfff passed [GitHub Actions 42515443745](https://github.com/TalhanAhmad/ERP-SYSTEM/actions/runs/42515443745), including both builds, fresh migrations, all 250 tests and documentation verification. No new schema migration was needed; the existing ten migrations and restricted runtime/RLS/private-storage/TLS preflight remain valid. Vercel deployment dpl_14WHhC1sBzQ9JnYovXcnK9ewagNW is READY at https://encova-workspace.vercel.app.

Twenty-two hosted checks passed: four retained owner/demo logins; directory search/pagination; non-admin denial; safe detail fields; actual People-to-Manage navigation; profile editing with unchanged login email/provider identity; tamper/Origin/stale rejection; immediate role change for an existing Supabase session; real open-work/project counts; retained-manager demotion denial and restoration; existing-session/new-login deactivation denial; inactive filtering; same-password reactivation with retained work; named audit history; 360px layout; protected owner controls; unchanged focused HR/direct-page denial; and management-browser sign-out.

The real-provider test created only a uniquely identified synthetic account/project/task. It deactivated that account afterward and preserved all three requested exploration accounts and the owner credential. No employee profiles/roles/statuses or active announcement were modified. The mobile management screenshot was inspected. The earlier full-run timeout and holiday-dependent fixture correction are recorded above; the final full browser suite and clean-runner CI passed without weakening application rules. Provider-wide session revocation, organization administration and staff email onboarding remain outside this acceptance.

## Dashboard, assignments and attendance role update

Local acceptance passed 260 automated checks: 121 unit, 126 real-PostgreSQL integration and 13 Chromium browser tests, with strict typing/lint and production build. Eight new integration cases verify shared card/list counts, scope, search/pagination, review queues, Super Admin punch/schedule denial, three staff roles, filtered staff status and preserved legacy history/job exemption. Two new browser journeys cover clickable matching cards/mobile filters and actual HR/Lead/Member punches while Root remains view-only. Existing work assignment/revision/review flow passes through the new task form.

The first new card browser assertion used an exact implicit label locator that included the select’s option text. The page’s accessible combobox name was correct. Switching the assertion to its accessible combobox role resolved the test mismatch; the complete 13-test run then passed in 51.8 seconds. Source ca49e9feddbc35a8c6ed3069b6a2249693c4dc03 passed [CI 42606060629](https://github.com/TalhanAhmad/ERP-SYSTEM/actions/runs/42606060629). Runtime/RLS/private-bucket/TLS preflight passed without a migration, and Vercel deployment dpl_FyaWEkk2TToL7vZZ2GykwmctheTC reached READY at the canonical URL.

Hosted acceptance passed 24 checks. Verified existing four role logins, scoped Lead/Member count-list agreement, four actual card links and destination filters/counts, anonymous/HR work-directory denial, Root punch denial without new ledger/events, Root schedule denial, three new roles’ actual personal punches and named Root status rows, focused HR menus, project-scoped live task creation, independent reviewer selection, member visibility, 360px layouts, sign-out and controlled cleanup. Mobile assignment/attendance screenshots were visually inspected.

The private hosted script initially omitted role labels from its fixture metadata and stopped before assignment creation; this was corrected and verification repeated. On the successful pass, sign-out correctly invalidated the shared verification session, requiring fresh owner authentication for cleanup. Cleanup then retired only the three new owned fixtures and archived their synthetic project. All three persistent exploration accounts and the owner remain ACTIVE; no passwords or existing staff attendance were changed.

## Completion pass core batch — local acceptance

Strict typing/lint, 121 unit, 144 PostgreSQL integration and 16 Chromium tests passed (281 total), plus production build. Eighteen new database cases cover calendar races/snapshots/leave protection, project/task lifecycle/history/access and organization/privacy/settings/cycles. Three new browser cases cover calendar replacement/holidays, actual lifecycle forms, and department/team/private employment placement at mobile width.

Findings: action form state persisted between Cancel/Reopen and Archive/Restore, corrected with distinct action keys. Calendar and department selectors initially included hidden edit controls; narrowed them to the target record/form. A dependent employment selector was reached on the outgoing Organization page; the test now waits for the Employment profile heading. Mutation controls also wait for hydration readiness. Final full browser regression passed all 16 tests. Hosted acceptance is pending publication.

Core batch publication/live acceptance: source 78a03c5a5cc2d638f262616577d7fe7e3ecb5e8e passed [CI 42639937002](https://github.com/TalhanAhmad/ERP-SYSTEM/actions/runs/42639937002). Thirteen hosted migrations and runtime/RLS/private-storage/TLS preflight passed. Vercel dpl_5Vhvx3dZw61j8UNvMTfpYmrfbBzx is READY. All 18 hosted checks passed, including actual new management forms, privacy/scope/races, synthetic holiday CRUD, guarded member removal, mobile employment and retained demo accounts. Only owned synthetic test identities/organization/work were retired or archived.

## Completion pass reports/learning/automation — local acceptance

Strict typing/lint, production build, 121 unit, 161 PostgreSQL integration and 18 Chromium tests passed (300 total). New cases verify task-link ownership, immutable report submissions/timing, private current-team access, cutoff/calendar/leave missing rules, focused-HR exemption, preferences/read-all ownership, maintenance lease/replay/cleanup, recipient-filtered mail claims, enrollment uniqueness/cycles of access, intern evidence, approved-task completion, private weekly feedback and explicit Root overrides.

The combined browser pilot exercises real separate accounts through work submission/approval, milestone evidence/completion, weekly feedback, daily report return/resubmission/acknowledgement and mobile history. Saved textarea content exposed unstable accessible names; shared labeled fields corrected them. Feedback read assertions were narrowed away from hidden editors. Login-heavy regression exceeded existing per-account limits; the helper now waits up to the real minute-long limiter window (90-second test budget), preserving all application limits. A macOS idle-sleep/display interruption was isolated; final local tests ran with temporary sleep inhibition. The complete final 18-browser run passed in about 1.4 minutes.

Reports/learning hosted acceptance: source 60c1d3d5319abcb4efe03943a63cce8e54a6d3ba passed [CI 42661510686](https://github.com/TalhanAhmad/ERP-SYSTEM/actions/runs/42661510686). Fifteen hosted migrations and runtime/RLS/private-storage/TLS preflight passed. Vercel dpl_5ynWvZVcp16XqE1dN7jWkHDPTCZQ is READY. All 20 live checks passed, including actual separate mentor/intern forms, independent review, evidence completion, weekly feedback, report revisions/timing, current-team access, personal preferences, real punches, independent correction with unchanged raw events, leave approval, mobile histories and maintenance replay. Mobile screenshots were inspected. Maintenance used an isolated historical date with no assigned staff; no natural cron invocation is implied. The private script first expected 422 for an evidence conflict; it was corrected to the intended 409 and the full live verification passed. Owned synthetic fixtures were retired/archived and the owner plus three persistent exploration accounts remain active.

Report edit race correction: actual rendered screenshot inspection found two saved report submissions containing the original text after a rapid Save/Submit sequence. Separate forms allowed the submit to arrive before a delayed PATCH; server versions prevented an overwrite but could not enforce UI intent. A single draft editor now saves current fields first and submits using the returned version. Retry keys persist through ambiguous network failures. The combined pilot now delays PATCH by 400 ms and verifies two distinct report bodies; both focused browser cases passed (8.7 seconds), with typing/lint/build. New live verification will explicitly compare current text and each submitted revision. No historical report or immutable revision is rewritten.

## Completion release verification — 10 November 2026

The core/report/learning batches above remain published. The sixteenth/seventeenth migrations and structured tables/security release are deployed and verified. Final local pass: 130 unit, 174 PostgreSQL integration and 20 Chromium browser checks (324 total), plus typing/lint/production build. Supabase contract coverage includes TOTP assurance and immediate app-session revocation. All final browser/accessibility/CI/live checks passed; intermediate defects/findings and fixes are retained in the work log.

Isolated restore: 47 public tables, 2,116 rows and 185 constraints restored from encova_test into encova_restore with matching per-table content/count fingerprints, 1.507 seconds. Production was untouched. Backup hash: ef3dbea60c96aac4bf6adc2ccf1f7a71eb19335c94e28277a6a5a77ee014cc27. This does not validate hosted PITR or stored-file recovery.

Synthetic service load: 100 new members, 100 requests at concurrency 10, zero failures, 210 ms total. Local p95: task page 32 ms, people page 55 ms, report status 51 ms. Timings exclude HTTP/auth/provider/network costs and do not establish hosted capacity.

Final isolated restore repeated after the complete regression: 47 tables, 1,710 rows and 185 constraints matched, 355 ms, SHA-256 1dbaaff3dbed179f72d0abae196f4f124f0247f8f3495e1af6e2812e9f4e06f9. Counts differ from the earlier drill because the integration suite recreates its dedicated synthetic data.

Natural scheduler evidence is now observed: Vercel request records show GET /api/internal/jobs at 2026-11-10 00:53:15.103 UTC, HTTP 200, clientUserAgent vercel-cron/1.0. Database attempt 554d6320-7f81-45d9-ad52-5e024995b9a0 began 00:53:17.283 UTC and succeeded; maintenance 7464ab02-dea4-43b6-9e4f-3db319562efa also succeeded. No manual request with a forged cron discriminator was used. The scheduled 00:15 expression runs with Hobby hourly precision.

## Final hosted acceptance — 10 November 2026

Source baf7d10b68f53883f6555864c70170931f7b2325 passed [CI 42809226350](https://github.com/TalhanAhmad/ERP-SYSTEM/actions/runs/42809226350), including all 324 tests and the Supabase-mode build. Controlled migrations sixteen/seventeen succeeded; restricted runtime/RLS/private-bucket/TLS preflight passed. Vercel deployment dpl_9d8mcA3q8ei1LsPNMqahrFAB4mcA is READY at https://encova-workspace.vercel.app.

All 56 hosted checks passed: 18 final table/security/storage checks, 20 report/learning/attendance/maintenance checks and 18 core organization/calendar/lifecycle checks. Actual browser Supabase TOTP enrollment/verification/removal, rejected AAL1 access, global logout across two sessions and role-change session revocation passed. CSV preview ownership/atomic replay, bulk stale rejection, saved-view privacy, mobile tables/exports, actual private-file bytes and independent reviewer scope passed. Report history contains distinct first/second text and retains original submission timing. Calendar replacement/holiday forms, manager cycles/private employment data, work actions, membership revocation, HR menus and Root attendance exemption passed. Only newly owned synthetic fixtures were retired/archived; all three persistent exploration accounts remain ACTIVE. Owner/demo passwords and owner MFA enrollment are unchanged. Live mobile table/report screenshots were inspected.

The provider initially rejected TOTP enrollment because both TOTP switches were disabled. A reviewed partial CLI diff/push changed exactly enroll_enabled and verify_enabled to true; signup, SMTP, callbacks and password policy were left unchanged. The workspace-wide privileged-MFA policy stays off. The [partial configuration example](../../supabase/auth-mfa.example.toml) records the required capability. Verification scripts were corrected to await client navigation and use absolute URLs for browser request contexts; no app guards were weakened.

Ten bounded concurrent hosted reads completed without errors: p50 1,833 ms, p95 2,180 ms, including network/auth/database costs. This is a small acceptance probe, not a 100-user hosted throughput guarantee.

Protected rollback compatibility rehearsal: authenticated the prior source 5b44e83 through Vercel CLI after all seventeen migrations; old settings/projects reads and local sign-out passed. Unauthenticated old immutable URLs redirect to Vercel SSO. The canonical production alias and database were not rolled back. Company-managed backup/Storage recovery and owner rollout decisions remain explicit external gates.

## Readiness follow-up — 11 November 2026

Local typing/lint/build and all 331 tests passed (131 unit, 179 PostgreSQL integration, 21 browser). New SDK/database tests verify restricted-mail gating, wrong-password and MFA rejection, first/final/expired dual-inbox callback behavior, same-ID versioned synchronization, old-session revocation, retained project identity, concurrent synchronization and email collision protection. Browser checks cover the public confirmation guidance, safe internal navigation, mobile fit and automated WCAG A/AA checks. Both-inbox provider HTTP is simulated in contract tests; live inbox delivery is not claimed.

Actual hosted logical recovery passed: 47 public ERP tables, 1,593 rows and 185 constraints matched a single exported read-only snapshot. Private backup SHA-256: 6275f9edc19ab5cb8707ca508343bac08ecfa86b7a4435cf4b3f703dfc90e60a. All 9 private objects (333 bytes) restored and matched both source bytes and all 9 available attachment-record digests; anonymous access was denied. The source public schema/original objects were not written; the new owned bucket was cleaned. Total 30.141 seconds. Private artifacts stay under .local/recovery, excluded from Git/Word. This covers actual hosted ERP/public data and objects, not managed Auth/PITR, off-site retention or regional disaster recovery.

The initial recovery retries exposed transient local DNS lookup, full-schema CREATE SCHEMA handling and delayed bucket empty/delete behavior. The final verifier uses direct TLS socket verification, lets pg_restore create the schema, checks READY and ATTACHED evidence and retries only its owned bucket cleanup. Positive evidence is written only after cleanup succeeds. No production restore or original-file deletion was performed.

## Readiness publication and hosted pilot checks

[CI 42976770350](https://github.com/TalhanAhmad/ERP-SYSTEM/actions/runs/42976770350) passed for exact source fcb7bc71a453eb59e1c645b07e8ee997814d52db, including all 331 tests and the Supabase-mode build. Runtime/RLS/private-bucket/verified-TLS preflight passed. No migration was needed. Deployment dpl_2SSKGD2xS2jojkBuHhoqN6xjLCa4 is READY at https://encova-workspace.vercel.app.

All 44 follow-up live checks passed: six own-email gating/status/callback checks, eighteen table/security/private-Storage checks, and twenty report/internship/attendance/leave/maintenance checks. The actual provider/member email and domain ID remained unchanged after a blocked email request. The live security page hides email mutation inputs under restricted mail; invalid email confirmation fails, and navigation stays internal. Real TOTP, global/session-role revocation, private uploads/reviewer download, scoped CSV/bulk/views and mobile tables still pass. Actual report versions/timing, independent task/milestone review, private feedback, personal preferences, real new-intern punches, correction, leave and maintenance replay pass. New fixtures were retired and persistent exploration accounts remain ACTIVE. Owner/demo credentials and owner MFA enrollment are unchanged. Positive dual-inbox email delivery remains untested live until a sending domain is supplied.

Natural processing remains healthy: CRON attendance run 69b39125-3664-4dd2-9305-ac3a3a36aa7d succeeded at 2026-11-11 00:53 UTC; daily maintenance 2e4967b5-7f96-4a3e-8f2e-ea717d2780f1 also succeeded. No orphaned encova-restore test buckets remain. The source ERP/Storage recovery receipt is distinct from local synthetic backup evidence.

Email-flow behavior follows [Supabase's updateUser API](https://supabase.com/docs/reference/javascript/auth-updateuser); database/object recovery boundaries follow [Supabase's backup documentation](https://supabase.com/docs/guides/platform/backups). This release keeps the sender restriction, feature flag and company policies intact pending the owner's domain/device/company decisions.

## Owner workweek configuration — 11 November 2026

Data-only change: company workweek set to Monday–Saturday through the live versioned Settings API, version 2. Four targeted checks passed: successful versioned mutation, matching API read-back, all six named browser checkboxes checked/Sunday unchecked, and preservation of the other settings/overall policy-confirmation state. Assigned attendance schedules and history were unchanged. No application code, migration, deployment or credential change was needed; the prior 331-test/44-live source verification remains historical evidence, not a newly repeated full regression.

## Owner shift configuration — 11 November 2026

Data-only change following acceptance of 09:00–17:00 Pakistan time: created the Monday–Saturday company policy and prospectively replaced the three active staff assignments from 12 November. Earlier segments retain their old policy through 11 November; new assignments are ongoing. Preflight found no future ledger records or reserved leave in the affected ranges.

Eight targeted live checks passed: complete non-Root coverage without overlap; correct retained old segments; exact unchanged previous AttendanceDay/AttendanceEvent hashes; Thursday/Saturday/Monday 09:00–17:00 WORKDAY snapshots; Sunday OFF_DAY snapshots for each account; actual browser assignment rows/effective dates; unchanged Root assignments and view-only attendance; no generated future ledger rows. Zero grace/closing buffer and report/leave/global-confirmation settings were preserved. No code/migration/deployment change or full-regression rerun was needed for this configuration update.

## Report deadline confirmation — 11 November 2026

The owner explicitly confirmed 17:00 Asia/Karachi. It already matched the live setting, so no mutation/version bump was required (version 2). Five targeted checks passed: API/browser setting equality; read-only shared-service evaluations before, exactly at and after the next assigned workday's cutoff; no Sunday missing obligation; existing report timing/version metadata hash unchanged; other settings and global confirmation state preserved. Boundary times were supplied only to the internal read-only query helper for verification, not exposed through a public clock override. No report submission/ledger/history row was created or rewritten. This is a policy confirmation with targeted verification, not a new full regression run.

## Leave-policy confirmation — 11 November 2026

Owner chose HR approval-only with no fixed annual quota, matching the existing service/UI. No application/schema/deployment change or redundant setting write was required. Code inspection confirms no annual leave-balance/cap is enforced; existing per-request date bounds, scheduled-day, overlap, attendance-conflict and independent-decision rules remain.

Eight live checks passed: new request PENDING without a reviewer; employee self-approval denied; actual persistent-HR browser approval records that reviewer; ON_LEAVE summary with no fabricated punch and overlapping request rejection; actual HR rejection releases reserved dates; Sunday-only request rejected; HR retains exactly Overview/Attendance/Leave approvals/Notifications; only the new owned Member/request fixtures are retired/resolved and all three persistent accounts remain ACTIVE. Existing employee requests were not modified. The approved synthetic request was canceled after verification, rejected evidence and audit history retained. Prior 331-test source verification is unchanged; this is a focused live policy check, not a newly repeated full suite.

## Finance foundation — 11 November 2026

F01–F03 local acceptance passed strict typing/lint, production build, 133 unit and 191 real PostgreSQL integration tests. The complete 23-case Chromium suite passed in 1.6 minutes. An added anonymous finance-session case then passed with the two existing finance cases in a focused 3-case run (2.9 seconds): 24 distinct browser cases / 348 distinct checks total, without summing repeated cases twice. No hosted finance acceptance or ledger fixture has been executed. See [exact finance results](../finance/testing/results.md).

Finance clean-runner acceptance: [CI 43058677199](https://github.com/TalhanAhmad/ERP-SYSTEM/actions/runs/43058677199) passed on 02c26a7 with all 348 tests (133 unit, 191 integration, 24 browser), migration 18 on a fresh CI database, both builds, typing/lint and documentation checks. The earlier run hit Ubuntu mirror DNS during optional OS/font installation; its retry was canceled, and the pinned 24.04 runner with lockfile-matching browser installation passed the complete unchanged browser assertions. Draft PR #1 remains unmerged; no hosted finance migration or launch occurred.

## Finance ownership — 12 November 2026

Local final verification passed 369 distinct tests: 133 unit, 211 PostgreSQL integration and 25 Chromium browser, plus typing/lint and both builds. The complete 25-browser run passed in 1.4 minutes after correcting a new-test endpoint mismatch and a real mobile table keyboard defect. Real PostgreSQL cases cover atomic setup/transfer/revoke, last-owner and identity protection, canonical concurrent receipts, current sessions and control races. Hosted TOTP behavior is an SDK/mock-provider contract, not a real device launch test. No database reset or hosted migration/grant occurred. See [finance results](../finance/testing/results.md) and [ownership operations](../finance/operations/ownership.md).

Final frozen-source confirmation (12 November): all 211 integration checks passed after the hidden-feature HTTP guard mapping; the complete final 25-browser run passed in 1.7 minutes (owner journey 3.9 seconds), including no-JavaScript POST/disabled-field assertions. The no-JavaScript locator was corrected to include React’s hidden streamed server markup; method/disabled assertions were retained. Local and Supabase-mode builds passed after these changes. Unit count remains 133; distinct total 369. Repeated checks are not added to this total.

F04 clean-runner [CI 43173242785](https://github.com/TalhanAhmad/ERP-SYSTEM/actions/runs/43173242785) passed on 9fea005624c8c734659e289da85d114499482cfd: all 369 tests, all 20 migrations on fresh PostgreSQL, strict typing/lint, local/Supabase-mode builds and docs. No live migration or finance enablement occurred.

## Finance setup — F05 — 12 November 2026

F01–F05 implementation acceptance is complete: 5/48 finance milestones, 43 remaining. Accounts/periods now have current-owner setup, selected-admin read-only access, strict configuration/version/hierarchy/usage rules and permanent restricted receipts/audit. Exact PKR strings and high-precision line rounding are shared primitives. Local acceptance totals 424 distinct tests (167 unit, 231 PostgreSQL integration, 26 browser), typing/lint and both builds. Final repeats/publication/CI are tracked in the finance results. Next F06 builds the posting engine; no journal, opening balance, company chart or fiscal year is seeded. Hosted ERP remains unchanged with finance disabled and 17 migrations; the test schema has 22. Word report and work log include this milestone. See the separate finance progress/results for current publication evidence.

F05 clean-runner [CI 43215176008](https://github.com/TalhanAhmad/ERP-SYSTEM/actions/runs/43215176008) passed on source 109a83c9721be9017571b8cc78259c661f0e1820: all 22 migrations on fresh PostgreSQL, 167 unit + 231 integration + 26 browser tests (424), strict typing/lint, local/Supabase-mode production builds and docs. Browser suite passed in 1.5 minutes. Initial source 03dc3e2 also passed CI 43214839447; counts are not doubled. No hosted migration, finance grant, merge or launch occurred.

## Finance through F10 — 12 November 2026

F01–F10 engineering acceptance is complete: 10/48 finance groups,38 remaining. Ordinary journal posting/reversal/idempotency, database balancing/immutability, dated core subset, shared accessible registers/drawer editing, parties/cash mappings and complete parent search are implemented. 488 distinct local tests: 185 unit, 275 real PostgreSQL integration and 28 Chromium browser. Strict typing/lint and both local/Supabase-mode production builds passed. Test schema has27 migrations; hosted ERP keeps17 with finance disabled. No company books, credential change, hosted migration/grant, merge or deployment occurs. Publication/clean CI follows in the focused finance results. Original ERP/learning progress is unchanged. Next F11: earned/deferred invoices.
