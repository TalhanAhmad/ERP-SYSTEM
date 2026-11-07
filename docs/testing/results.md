# Verification results

Date: 7 November 2026, Asia/Karachi. Environment: macOS ARM64, Node 24.22.2, pnpm 12.18.0, real PostgreSQL 17.9 on loopback. All test accounts and work data are synthetic. Development, test and restore databases are distinct.

## Latest outcomes

| Command / check | Outcome | Evidence and scope |
| --- | --- | --- |
| pnpm install / peers check | PASS | Exact lockfile resolved; no peer dependency issues. |
| pnpm exec prisma validate | PASS | Initial schema validated; subsequent migrations and generated client succeeded. |
| pnpm db:migrate:deploy on dev/test | PASS | Six migrations, including reviewed SQL integrity constraints, applied to separate databases. Test database was recreated locally to validate a clean migration sequence. |
| pnpm typecheck | PASS | Strict TypeScript, application/services and test sources. |
| pnpm lint | PASS | No lint errors in latest check. |
| pnpm test:unit | PASS — 88 tests | Task transitions, schemas/unknown fields/URLs, independent review, Karachi midnight, CSV sanitization, attendance summaries and overnight rejection. |
| pnpm test:integration | PASS — 52 tests | Real PostgreSQL transactions, concurrent versions/submissions/reviews, rollback, scope, invitations, signup bypass denial, active/unlinked users, last-admin guard, session revocation, attendance/leave race, corrections, report immutability and worker leases/retry/recovery. |
| pnpm build | PASS | Production compilation, TypeScript and page generation; includes password reset screens and all implemented pages. |
| pnpm test:e2e | PASS — 2 browser tests | Separate role contexts; project/membership/task creation, start, submit, return, resubmit, approval, immutable revision visibility and unauthorized URL denial. A 360px dashboard/work check also passes. Latest run: 4.8 seconds on port 3100; local app on 3000 remained available. |
| pnpm audit --prod --json | PASS | Registry audit reported 0 info/low/moderate/high/critical vulnerabilities. This is not a general security certification. |
| pnpm verify:docs | PASS | Required documents, 60 milestone records and local links validated. |
| DOCX export integrity | PASS | ZIP/XML validation and macOS textutil conversion both succeeded; the Word report is readable. |
| Git commit/push | PASS | Foundation commit 31e55e4 pushed; local and remote SHA equality verified. |

## Supabase/Vercel foundation verification

Latest local results: 88 unit, 52 integration and 2 browser tests passed (142 total); typecheck and lint passed. The six migrations applied cleanly both as an upgrade and into the separate empty encova_restore database. That database name does not constitute a backup-restore demonstration.

Supabase SDK + real PostgreSQL contract tests verify safe session DTOs/HTTP-only cookies, server identity verification, client role metadata rejection, immediate domain deactivation denial, legacy endpoint closure, same-origin protection, generic reset results, internal-only redirects, sign-out cookie clearing and scheduler authentication. Provider HTTP is simulated in these tests; no live Supabase result is claimed. Separate PostgreSQL tests cover provisioning failure/retry/revocation/concurrency, RLS/grants and the bounded job pass.

Both a normal build and a Supabase-selected Vercel-mode build passed. The latter used configuration fixtures/reserved example URLs and did not contact a real hosted project. The same production artifact passed the existing local compatibility browser journey after synthetic account preparation. Production dependency audit again reported no known vulnerabilities and no peer dependency conflicts.

A browser rerun initially failed because integration tests reset the shared test database and the fixture-preparation step was omitted. Recreating the synthetic accounts before rerunning resolved it. The CI workflow already prepares accounts between these phases and now also compiles the Supabase configuration explicitly.

No real Supabase/Vercel project, hosted auth session, provider SMTP delivery, storage upload/download, live scheduler, MFA rollout, hosted database/pool check, production migration or backup restore is verified. The deployment preflight needs authenticated project access and real configuration. User confirmation of connected apps could not be corroborated: the catalog still reports both providers not installed and no project APIs are exposed.

## Remote verification

Latest: Supabase/Vercel foundation commit 31e55e48da139c7012e6c64d583eb6922a591b4d passed GitHub Actions run 42403511665: https://github.com/TalhanAhmad/ERP-SYSTEM/actions/runs/42403511665. All configured checks passed on the clean Ubuntu runner, including the new Supabase-mode production build. This remains a build/contract verification, not live-provider acceptance.

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
- No real company records, deployed host, production migration, privileged MFA rollout, performance baseline, backup restore or incident drill were tested.
- Organization, internship, advanced tables/import/export and remaining lifecycle requirements are listed in the backlog. They are not counted as passed.
- GitHub CI passed on the clean Ubuntu runner for published commit 396a146; evidence: https://github.com/TalhanAhmad/ERP-SYSTEM/actions/runs/42384281499. This verifies the implemented application, not the unfinished pilot gates.
