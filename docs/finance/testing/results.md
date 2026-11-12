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

## F04 ownership acceptance — 11–12 November 2026 (Asia/Karachi)

Implementation/early local checks began 11 November; final tracking continues 12 November. No effort hours are asserted. Final local regression passed **369 distinct tests**: 133 unit, 211 PostgreSQL integration and 25 Chromium browser cases. Strict typing/lint and production build passed. Targeted ownership plus real-SDK/mock-provider tests passed 38 cases before the complete regression.

Commands: caffeinate -di pnpm typecheck; caffeinate -di pnpm lint; caffeinate -di pnpm test:unit; caffeinate -di pnpm test:integration; caffeinate -di pnpm build; DATABASE_URL=(dedicated loopback encova_test) pnpm test:e2e:prepare; PLAYWRIGHT_PORT=3100 caffeinate -di pnpm test:e2e. The final complete browser run passed 25/25 in 1.4 minutes; the new owner journey passed in 3.8 seconds. Repeated cases are not added to the distinct count.

Coverage includes explicit/simultaneous bootstrap, username/immutable-ID binding, wrong/expired/fabricated proof, current-owner-only actions, ineligible targets, concurrent same-key grant replay, request-hash conflict, stale versions, transfer/target acceptance/cancel/expiry, current-owner raw-SQL/ORM protections even with the feature flag off, protected provider bindings, verified own-email synchronization, session revocation after proof, transfer-vs-revocation and transfer-vs-generic-deactivation races, runtime privilege denial, actual restricted function execution, CSRF/strict HTTP bodies/private errors, operator credential-file consumption, operator recovery/audit and former-session revocation.

The browser journey exercises wrong-password recovery, owner grant, selected-user read-only UI, transfer request/recipient acceptance, former-owner denial, new-owner grant/revoke, immediate recipient denial, blocked owner demotion through the actual /users API, 360px automated WCAG checks and focused ArrowRight table scrolling. Provider MFA coverage uses the real SDK with a mock HTTP contract: wrong password, missing factor/code, invalid fresh code despite prior assurance, and successful password-plus-fresh-TOTP. It does not establish live physical-device acceptance.

Failures resolved: fixture generic-type issue; React-hook lint naming for a server capability consumer; one worker-start timeout (rerun with sleep inhibition); wrong /people role path in the new browser test (corrected to the existing /users path, with administration locking aligned); a real mobile keyboard-access defect in the scrollable history table (added named focusable scroll regions and a keyboard test). An initial full browser pass had 24 successes/one accessibility failure; the final unchanged full assertions then passed 25/25.

Prisma rejected a proposed whole test-database reset before execution. Abandoned that action; preserved migration 19's checksum and used additive migration 20. Corrected its SQL CASE parsing, resolved only the failed migration metadata and successfully applied the function replacement. The final test confirms the original migration-19 checksum. No reset or dangerous-action consent override was executed. Owned fixture cleanup preserves other ERP records/grants and retains immutable audit/receipt evidence.

Current local schema: 20 additive migrations. Hosted schema: unchanged 17. No live owner grant, provider configuration/MFA/password change, finance enablement, real financial import or ledger/accounting acceptance was performed. Supabase-mode production build also passed with synthetic configuration and no live connection. Source 9fea005 is pushed; CI 43173242785 passed all 369 tests, migrations, both builds and required checks.

Final review also added fail-closed credential forms: disabled before hydration, POST fallback, and a real no-JavaScript browser assertion. Added a generic HTTP mapping/test so the database owner guard returns a safe 409 conflict even while finance is hidden; older live schemas need no finance query. Final repeated backend/browser/build results are recorded after these changes.

Final frozen-source confirmation (12 November): all 211 integration checks passed after the hidden-feature HTTP guard mapping; the complete final 25-browser run passed in 1.7 minutes (owner journey 3.9 seconds), including no-JavaScript POST/disabled-field assertions. The no-JavaScript locator was corrected to include React’s hidden streamed server markup; method/disabled assertions were retained. Local and Supabase-mode builds passed after these changes. Unit count remains 133; distinct total 369. Repeated checks are not added to this total.

F04 clean-runner evidence: [CI 43173242785](https://github.com/TalhanAhmad/ERP-SYSTEM/actions/runs/43173242785) passed on source 9fea005624c8c734659e289da85d114499482cfd. No live finance migration/grant or merge occurred.
