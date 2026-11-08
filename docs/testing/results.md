# Verification results

Date: 8 November 2026, Asia/Karachi. Environment: macOS ARM64, Node 24.22.2, pnpm 12.18.0, real PostgreSQL 17.9 on loopback. All test accounts and work data are synthetic. Development, test and restore databases are distinct.

## Latest outcomes

| Command / check | Outcome | Evidence and scope |
| --- | --- | --- |
| pnpm install / peers check | PASS | Exact lockfile resolved; no peer dependency issues. |
| pnpm exec prisma validate | PASS | Initial schema validated; subsequent migrations and generated client succeeded. |
| pnpm db:migrate:deploy on dev/test | PASS | Nine migrations, including reviewed SQL integrity constraints, applied to separate databases. Test database was recreated locally to validate a clean migration sequence. |
| pnpm typecheck | PASS | Strict TypeScript, application/services and test sources. |
| pnpm lint | PASS | No lint errors in latest check. |
| pnpm test:unit | PASS — 118 tests | Task transitions, schemas/unknown fields/URLs, independent review, Karachi midnight, CSV sanitization, attendance summaries and overnight rejection. |
| pnpm test:integration | PASS — 95 tests | Real PostgreSQL transactions, concurrent versions/submissions/reviews, rollback, scope, invitations, signup bypass denial, active/unlinked users, last-admin guard, session revocation, attendance/leave race, corrections, report immutability and worker leases/retry/recovery. |
| pnpm build | PASS | Production compilation, TypeScript and page generation; includes password reset screens and all implemented pages. |
| pnpm test:e2e | PASS — 8 browser tests | Separate role contexts; project/membership/task creation, start, submit, return, resubmit, approval, immutable revision visibility and unauthorized URL denial. A 360px dashboard/work check also passes. Latest milestone run: 13.1 seconds on port 3100; local app on 3000 remained available. |
| pnpm audit --prod --json | PASS | Registry audit reported 0 info/low/moderate/high/critical vulnerabilities. This is not a general security certification. |
| pnpm verify:docs | PASS | Required documents, 60 milestone records and local links validated. |
| DOCX export integrity | PASS | ZIP/XML validation and macOS textutil conversion both succeeded; the Word report is readable. |
| Git commit/push | PASS | Email source 4d76a19 pushed and verified by successful CI 42481163707; current report updated. |

## Supabase/Vercel foundation verification

Current milestone local results: 118 unit, 95 integration and 8 browser tests passed (221 total); typecheck and lint passed. The six migrations applied cleanly both as an upgrade and into the separate empty encova_restore database. That database name does not constitute a backup-restore demonstration.

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
