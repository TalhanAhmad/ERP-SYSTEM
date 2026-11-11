# Finance verification results

11 November 2026, local development; F01–F03 acceptance passed. Test identities and accounting examples are synthetic only.

| Command / check | Actual result |
| --- | --- |
| pnpm db:generate | Passed; Prisma 7.10.1 |
| DATABASE_URL=(loopback encova_test) pnpm db:migrate:deploy | Passed; additive migration 18 applied only locally |
| Initial targeted finance integration run | 12 passed; stale-role fixture TypeScript error corrected before final verification |
| pnpm typecheck && pnpm lint | Passed |
| pnpm test:unit | 133 passed |
| pnpm test:integration | 191 passed, including 12 finance cases |
| pnpm build | Passed; finance page/API are dynamic |
| DATABASE_URL=(loopback encova_test) pnpm test:e2e:prepare | Passed; explicit synthetic selected admin, no real owner grant |
| PLAYWRIGHT_PORT=3100 caffeinate -di pnpm test:e2e | Complete 23-case suite passed in 1.6 minutes |
| PLAYWRIGHT_PORT=3100 caffeinate -di pnpm test:e2e tests/e2e/finance-access.spec.ts | 3 passed in 2.9 seconds, including added anonymous navigation/API check |
| Supabase-mode pnpm build:vercel (synthetic production configuration only) | Passed; no live connections/deployment |
| pnpm verify:docs | Passed; original 60 + separate 48 milestone records and documentation links |

Distinct count: **348** (133 unit + 191 integration + 24 browser). Two finance browser cases were repeated in the focused run and are counted only once. Production application source was unchanged between the full and focused browser runs; the focused run added an anonymous-session assertion. Next redirects anonymous finance navigation to login; its existing server log includes an UNAUTHENTICATED exception, with no credentials/financial payload.

Finance coverage: Member/HR/Lead/unselected Super Admin denial; real sessions; selected minimal DTO; disabled flag; stale role/status; post-revocation request and delayed callback denial; transaction lock lifetime; one-active-grant/revocation pair/FK constraints; strict generic People field rejection; runtime read authorization but denied grant writes; immutable separate audit; Data API denial; setup replay twice; selected navigation/revocation, 360px layout and automated WCAG A/AA scan.

The pg adapter emits an existing concurrent-query deprecation warning; no test failed. No framework/adapter upgrade was introduced. Supabase-mode build also passed with synthetic production configuration. Source 6a82a278b143389fb6573042edfb7821a0636b88 is pushed on finance/foundation. Draft PR: https://github.com/TalhanAhmad/ERP-SYSTEM/pull/1. CI run 43048421256 attempt 1 passed migrations, typing/lint, unit/integration checks and build, then failed before browsers because the Ubuntu package mirror could not resolve azure.archive.ubuntu.com. Attempt 2 again stalled at the OS install and was canceled before tests. Logs show the required Chromium shared libraries were already installed; CI is now pinned to that Ubuntu 24.04 runner and installs the lockfile-matching browser without repeating the optional OS/font package install. Browser launch and the complete test suite remain mandatory; no test is skipped or relaxed. Replacement [CI 43058677199](https://github.com/TalhanAhmad/ERP-SYSTEM/actions/runs/43058677199) passed on 02c26a71b731d8ea5181a71f4fe5275f3c48e748, including migrations, strict typing/lint, all 133 unit + 191 integration + 24 browser tests, both production builds and docs. No hosted migration/grant, posting engine, ledger/report acceptance, live MFA enrollment, finance backup drill or accounting sign-off is claimed.

The final publication update changes documentation/Word evidence only; its local documentation links, Word ZIP/XML and configured-private-value scan are checked before push. No application code changed after the successful source CI. The PR remains a draft and is not merged or launched.
