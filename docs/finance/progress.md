# Finance progress

Updated 13 November 2026 (Asia/Karachi). Engineering acceptance remains separate from the original ERP/learning roadmap; no effort hours asserted.

**F01–F19 complete: 19 of 48 finance milestones; 29 remain.** Current authorized scope continues through F25 on finance/f16-f25, with separate milestone commits/pushes. F16 adds bills/immediate paid expenses and cost/project splits. Latest observed checks: 219 distinct unit cases,355 PostgreSQL integration cases, one new Chromium bill journey, typing/lint and both production builds passed. Prior34 browser journeys will be rerun with the final scope. See [current delivery tracker](delivery-F16-F25.md). Current test schema34 additive migrations; live finance remains disabled.

The following records describe the previously completed and merged F15 release:

F12 supplies invoice screens/line previews/private posted PDF. F13 supplies partial/multiple receipts and explicit fees. F14 supplies unallocated/mixed advances and later applications without duplicate cash. F15 supplies capped original-line credits, paid-credit liability/refunds, dated reversals and whole settlement release while retaining cash. Typed sources, dated events, snapshots, private access and the one balanced engine remain enforced. See [delivery report](delivery-F12-F15.md), [exact verification](testing/F12-F15-results.md) and [customer accounting rules](accounting/customer-cycle.md).

Final local verification: **596 tests** (216 unit + 346 real PostgreSQL integration + 34 Chromium browser), strict typing/lint and both local/Supabase-mode production builds passed. Full browser 2.0 minutes, including all original ERP journeys. All 60 concrete finance API paths/verbs/references are verified; Word/private-value and local-link checks accompany publication.

Separate pushes: F12 abf7c6c (CI 43407757976 passed), F13 1e8c8dc (CI 43409706332 passed), F14 b141833 (CI 43412224862 passed). F15 b5a424bc passed CI 43419008430 on a fresh runner with all 596 tests and 33 migrations. Current branch: main. PR #2 containing F11–F15 is merged; the milestone source branch is retained.

Test schema:33 additive migrations. Hosted ERP's last verified17-migration schema and disabled finance are untouched by this delivery. No real chart/year/cutover/opening books, hosted owner/grant/MFA setup, financial deployment, automatic client email or launch occurred. The designated intended owner remains the existing zablerkhanahmad@gmail.com account; synthetic tests do not configure live ownership.

F16–F48 remain, including suppliers/expenses, configurable tax/withholding, financial attachments, cash/funding/assets/investments/projects, reconciliation/statements/exports, closing/opening books/jobs, complete F43 fixtures and company/accountant/release acceptance. Register totals are source views, not financial statements. All 60 original learner demonstrations remain separate and pending.

Historical F01–F10 was merged through PR #1 at7d9ca2e on 12 November 2026. F11 source d748284 passed CI 43399849090. Their records remain in prior focused reports; they are not used as final F15 source verification.


## Final F15 publication

[CI 43419008430](https://github.com/TalhanAhmad/ERP-SYSTEM/actions/runs/43419008430) passed on exact source **b5a424bc42121a185da4d44d857e5ad59040107b**: all 33 migrations on fresh PostgreSQL, 216 unit + 346 integration + 34 Chromium tests (**596**), strict typing/lint, local and Supabase-mode production builds and documentation/API verification. Each requested milestone was committed/pushed separately; [draft PR #2](https://github.com/TalhanAhmad/ERP-SYSTEM/pull/2) now covers F11–F15 on finance/invoices-f11. At initial F15 publication, merge and hosted release were pending; the subsequent merge is recorded below.


## PR #2 merge — 13 November 2026

[PR #2](https://github.com/TalhanAhmad/ERP-SYSTEM/pull/2) was merged into main at 18:43:40 Pakistan time on 13 November 2026 (13:43:40 UTC), following Talha’s explicit request. Merge commit: **32964e847ccef43f6152a4e406239a9c657da4be**. A merge commit preserved the separate milestone commits. Exact PR head86c0cd2aebcdf28e7c9535789b8fec4ede4bb1b8 passed [CI43423801209](https://github.com/TalhanAhmad/ERP-SYSTEM/actions/runs/43423801209) before merge. Local main was fast-forwarded to the merged result; application/schema/test/script content is identical to that verified head. No manual hosted finance migration or activation was performed.

## F17 development
Supplier payments, advances, original-cost credits/refunds and dated corrections implemented. Latest focused regression96 and new Chromium journey passed. Current source test schema36, API89 paths. F18 next; no live financial migration or activation. F16 source68afc4b passed fresh-runner CI43445524244 with609 distinct tests (219unit+355integration+35browser).

## F18 development
Reviewed policy setup, inclusive/exclusive source taxes, original net/tax credits and evidenced settlement withholding implemented; all remain explicit and optional. No real rates or live enablement. Test schema43 and API91 paths;12 tax integration and225 unit checks passed. New browser policy/source/PDF/withholding journey passed5.5s. F19 next. F17 exact-source CI43447137270 passed626 tests on a fresh runner.

## F19 development
Typed private evidence, signed malware quarantine, strict current-access bounded download, immutable posted retention and explicit operator setup/cleanup implemented. Fourteen backend and three unit checks passed;6MiB browser journey passed5.6s. Schema47, API97 paths. Live finance/scanner remain disabled/unconfigured. F18 corrected exact-source CI43455396870 passed642 cases. F20 next.
