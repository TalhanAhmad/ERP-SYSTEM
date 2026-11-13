# F12–F15 verification record

13 November 2026, Asia/Karachi. Tests run only against isolated encova_test and synthetic browser/provider/storage fixtures. Repeated runs are not added to distinct counts. No effort hours, learner demonstrations or accountant approvals are inferred.

## Milestone publication

| Milestone | Separate source commit | Observed verification |
| --- | --- | --- |
| F12 | abf7c6ccc0492414aeb9db8635f8eab7ae9652f5 | 208 unit + 301 PostgreSQL integration locally; invoice UI/PDF journey; both builds; [CI 43407757976](https://github.com/TalhanAhmad/ERP-SYSTEM/actions/runs/43407757976) passed complete 30-browser suite and fresh 28-migration chain |
| F13 | 1e8c8dc4e5d95ee6db36c950a59e71f06695bd40 | 212 unit + 314 integration locally; receipt browser/fees/multi-allocation; both builds; [CI 43409706332](https://github.com/TalhanAhmad/ERP-SYSTEM/actions/runs/43409706332) passed complete 31-browser suite and fresh 31-migration chain |
| F14 | b141833be6fd1d21f363c3f1cbbac9edff09ec10 | 214 unit + 322 integration, all 11 finance browser journeys locally; both builds; [CI 43412224862](https://github.com/TalhanAhmad/ERP-SYSTEM/actions/runs/43412224862) passed complete 32-browser suite and fresh 32-migration chain |
| F15 | Pending exact source publication | Final local regression and source CI below |

## Final local acceptance

216 unit tests passed. Final PostgreSQL integration repeat passed **346** tests after the final discounted-net cap and competing-reversal cases; an earlier344-case full run also passed. Full Chromium suite passed **34** tests in 2.0 minutes, including all original ERP HR/attendance/announcement/task/attachment/security journeys. Distinct total: **596** (216 + 346 + 34), without adding repeated runs.

Actual synthetic mobile credit-note screenshot was visually inspected: frozen contacts, held balance, original/reversal journals and history render correctly; wide tables use named focusable horizontal scroll regions. New F15 browser journeys: paid credit/private PDF/refund/double dated undo6.6 seconds; release-while-retaining-cash/dated release and receipt undo4.2 seconds. All finance screen mobile WCAG/overflow checks passed; unselected/member PDF access denied with private/no-store. Strict typing/lint, local production build and Supabase-mode production build results are confirmed before publication. Both invoice/credit-note PDF font files were verified in Next function traces.

Command families: caffeinate -di pnpm test:unit; caffeinate -di pnpm test:integration; DATABASE_URL=(dedicated encova_test) pnpm test:e2e:prepare; caffeinate -di pnpm build; PLAYWRIGHT_PORT=3100 caffeinate -di pnpm test:e2e; pnpm typecheck/lint/verify:docs; AUTH_PROVIDER=supabase and synthetic production-shaped provider/pool URLs/keys caffeinate -di pnpm build:vercel. No hosted database connection for builds. Migration deploy uses the dedicated-target guard and additive deployment only.

## Financial checks

Earned/deferred/mixed invoice rounding and explicit discounts; uncertain create response retry; frozen contacts and private posted PDF. Partial/multiple receipt allocations, fees9800+200=10000, source/date/party/account eligibility, archived-project settlement and no duplicate revenue. Unallocated/mixed advances and later applications create liability/AR effects without a second bank entry. Current and later-date capacities reject concurrent/backdated over-allocation and over-refund.

Unpaid, paid, partially paid, deferred and discounted-line credits use original mappings and cumulative net limits. A draft credit's AR/held split is determined at posting; a forged balanced raw split is rejected at commit. Refunds debit customer liability/credit cash, with no expense or receivable entry. Paid credits can apply to another invoice. Dated reversals retain historical AR/deferred/pool/credit balances; consumed source funds must be restored first. Whole settlement release keeps cash, creates a separate liability pool and reverses safely only if the pool/invoice capacity permits. Competing reversal keys create one correction.

Missing source events, raw source/line/split/event mutation, wrong parties/accounts, future postings, stale versions, key conflicts and revoked access all fail without partial accounting. Actual encova_app commands work; direct finance table/private helper/sequence writes and Data API access remain denied after setup replay. No credential material enters audit/PDF/retry history.

## Resolved findings

F13 real posting tests exposed a PL/pgSQL loop-record/alias collision and a nonexistent cash-master usage column. Additive30/31 corrected them; the existing GL usage marker already freezes cash mappings. F14's initial migration 32 CASE parsing failed transactionally; corrected unapplied SQL passed an explicitly rolled-back DDL rehearsal, then the failed record alone was resolved and deployment succeeded. F15 DDL passed that rehearsal and first deployment. No database reset or old applied checksum edit.

The new bidirectional API verifier initially missed the existing aliased GET re-export; parser support was added. It now validates every concrete finance path and exported verb against OpenAPI, including all 60 paths, plus local references. No application endpoint was weakened to satisfy a check. The existing pg adapter concurrent-client deprecation warning is observed; tests pass and no new unawaited direct pg queries are introduced.

## Boundaries

Test schema has33 additive migrations; hosted ERP's last verified17-migration schema and disabled finance remain untouched by this work. No real chart/year/cutover/opening books, live owner/grant, deployment, automatic email, company accountant sign-off or full accounting fixture is claimed. F16 onward remains scheduled separately.

## Publication

Pending exact F15 source commit, push and fresh-runner result. Prior milestone CI is not substituted for final-source CI.
