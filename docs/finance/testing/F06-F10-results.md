# F06–F10 verification — 12 November 2026

488 distinct local tests: 185 unit, 275 real PostgreSQL integration and 28 Chromium browser. Strict typing/lint and both local/Supabase-mode production builds passed. Distinct total **488**. New scope adds 18 unit, 44 integration and 2 browser cases to F05's 424; repeated runs are not added. Source 4be8c72eed903d2acd7b22be793a76bba638c55a is committed/pushed; [CI 43238001511](https://github.com/TalhanAhmad/ERP-SYSTEM/actions/runs/43238001511) passed the full fresh-database verification.

| Check | Actual result |
| --- | --- |
| Prisma generate and guarded migrate deploy, explicit loopback encova_test target | Passed; additive migrations 23–27, 27 total; no reset |
| caffeinate -di pnpm typecheck / pnpm lint | Passed |
| caffeinate -di pnpm test:unit | 185 passed |
| caffeinate -di pnpm test:integration | 275 passed, 52.0 seconds final complete run |
| caffeinate -di pnpm build | Passed |
| DATABASE_URL=(dedicated encova_test) pnpm test:e2e:prepare | Passed; explicit synthetic identities/grants only |
| PLAYWRIGHT_PORT=3100 caffeinate -di pnpm test:e2e | 28 passed in 1.5 minutes |
| Final complete-run finance journeys | Ledger 5.3s; master setup 3.8s; F05 setup regression 4.8s |
| AUTH_PROVIDER=supabase with synthetic production configuration, pnpm build:vercel | Passed; no live connection/deployment |
| OpenAPI path/verb/reference validation | 29 concrete implemented paths; all local references resolved |
| Documentation and Word/private-value validation | Recorded at publication after final export |

## Ledger and data evidence

Deferred balance checks reject raw SQL imbalance, source/line mismatch and append-only tampering. Posted source/header/lines cannot update/delete; invalid postings roll back usage marks, receipts and audit. Exact decimal-string validation rejects floating/coerced/non-PKR/extra-precision inputs and bounds saved draft totals. Audit revision amounts are decimal strings as well. Controls, inactive/group accounts, archived projects, unavailable periods and future posting dates are rejected by the database path. Current session/grant/owner checks, permanent canonical request receipts, distinct-key source uniqueness, optimistic updates, atomic versioned batch conflicts and exact opposite dated reversals are tested. A batch conflict identifies the first changed draft; successful batches return every updated row version.

The F08 subset posts prepayment/accrual 120,000, recognizes expense 10,000 and reverses recognition on the following date. Before reversal the cutoff retains 110,000 prepayment, 10,000 expense and 120,000 accrued liability. Original plus reversal debits and credits total 140,000 each with zero net. No bank/AR/AP/asset/investment register is bypassed; the full 1,445,000 invoice/cash/subledger fixture remains later acceptance.

## Browser evidence

Real journal creation, drawer inline edit, wrong-password recovery, reviewed Post, immutable detail, dated reversal, atomic batch void, filtered registers, selected-owner restrictions, account search, current-access denial, mobile/keyboard scrolling, native Escape/focus return, no-JavaScript detail and automated WCAG checks passed. Party/cash journey includes a committed party create whose first response is replaced with a synthetic 503; retry retains the request key, returns the canonical record and creates exactly one party. Password/code fields clear after attempts; credentials never enter retry payload state. Selected administrators read party/cash records without setup controls. Synthetic mobile screenshots were inspected; a loading-state capture was corrected by waiting for the actual cash row.

## Findings resolved

Migration 23 initially failed SQL CASE parsing; confirmed no partial table, resolved only the failed migration record, corrected it and deployed additively. Added migrations 24/26/27 for draft bounds/revision snapshots, exact snapshot-string precision and canonical batch versions/conflict identity, keeping all applied checksums. A date-only browser fixture used host-local Date conversion and selected the preceding date; changed its SQL result to ISO text. An exact select locator included option text; separated labels from selects and improved owned cleanup. F05 parent selector then needed exact label/search targeting; final complete regression passed. Invalid amount handling/readonly source boundaries were not weakened. Fresh-runner tests create their own mock Data API roles and future period rather than depending on test order.

Only encova_test and owned synthetic fixtures were changed. Finance config/journal/audit history is retained; cleanup releases only its owned singleton/grants, retires owned backend people and preserves ERP records. Hosted MFA contract remains the prior SDK/mock-provider test; no live device/accountant/financial launch or production-throughput claim is made.

Final focused ledger repeat passed27/27 after adding an archived-project assertion to the existing posting-boundary case; typing/lint passed again and the distinct count remains488. Both Word reports passed ZIP/XML/image relationship checks; the focused report also passed the macOS document parser. All99 changed/new files passed a scan against16 configured private values, without printing them. No application code changed after the complete local regression. Exact source/CI publication follows.

## Final publication evidence

Exact-source [CI 43238001511](https://github.com/TalhanAhmad/ERP-SYSTEM/actions/runs/43238001511) passed on 4be8c72eed903d2acd7b22be793a76bba638c55a: 185 unit +275 PostgreSQL integration +28 Chromium browser tests (**488**), all27 migrations applied to fresh PostgreSQL, strict typing/lint, local and Supabase-mode production builds and documentation. CI browser suite passed in2.2 minutes; the complete verify job took5m19s. Source is committed/pushed on finance/foundation; draft PR#1 remains unmerged. Hosted ERP retains17 migrations with finance disabled; no live finance migration/grant or deployment occurred.

The final tracking commit updates documentation/Word evidence only. Its documentation links, Word ZIP/XML/images/private-value checks are validated before push; the passing source CI above covers the unchanged application/schema source.
