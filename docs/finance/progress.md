# Finance progress

Updated 15 November 2026 (Asia/Karachi). Engineering acceptance remains separate from the original ERP/learning roadmap; no effort hours asserted.

**F01–F36 locally complete:36 of48 finance milestones;12 remain.** PR3 merged atb83951d after exact-head CI43584464377. Separate F26–F35 source pushes passed fresh CI. F35 source4b4058f162b371b454200de22f12166e79a45969 passed [fresh CI43729128979](https://github.com/TalhanAhmad/ERP-SYSTEM/actions/runs/43729128979):72 fresh migrations,962 tests and both builds/type/lint/API checks. F36 adds dated historical AR/AP ageing and source-event running history, exact due boundaries and full-company subledger/control agreement independent of display filters. 985 distinct local checks passed:285 unit,645 actual PostgreSQL integration (329.29s),55 Chromium (3.4m). Both production builds, strict typing/lint,203 concrete API paths/verbs/references and all73 applied migration checksums passed. The new historical-ageing browser journey passed3.2s, including real later payment/earlier cutoff, exact dated source history, current private API, employee denial, mobile and WCAG. Full/focused Word/private-value checks accompany separate F36 publication; fresh CI is observed after push. See [continuation tracker](delivery-F26-F48.md), [verification](testing/F26-F48-results.md), [Word report](Encova_F26-F48_Report.docx) and [your review pack](review/owner-review-pack.md). F37 project/funding/investment/asset roll-forward reporting is next. Human F47 review and F48 live activation remain separate. Finance stays disabled live; no hosted schema/grants or real company books/statements were adopted.

Prior F16–F25 evidence remains in [delivery](delivery-F16-F25.md), [verification](testing/F16-F25-results.md) and its [historical Word report](Encova_F16-F25_Report.docx). F25 exact source7e27443 passed CI43583420594 with759 checks and55 fresh migrations.

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


F27 separate publication verified: source9e23dfc36b472ac540617245df753cb9292445de passed [fresh CI43604433797](https://github.com/TalhanAhmad/ERP-SYSTEM/actions/runs/43604433797), including60 fresh migrations, all798 tests, both builds/type/lint/142-path docs. F28 engineering and final verification are in progress; [cost-allocation rules](accounting/cost-allocation.md) describe the implemented boundary.


F28 source2c3b0031e87fab2a63e0445118e216e7f61718ca passed [fresh CI43609969834](https://github.com/TalhanAhmad/ERP-SYSTEM/actions/runs/43609969834):61 migrations, all818 tests, both builds/type/lint/152-path API verification. F29 local acceptance is complete; source publication/fresh CI are recorded separately.


F29 sourcea6b014b9f03ad70e62c8cff3733a4e6070ad3bec passed [fresh CI43612791776](https://github.com/TalhanAhmad/ERP-SYSTEM/actions/runs/43612791776):63 migrations, all838 tests, both builds/type/lint/162-path documentation checks. F30 local acceptance is complete; separate publication/fresh CI is recorded in the continuation tracker.


F30 source151ab2ef05a4a752477ef3d73cca9d8af65a9d78 passed [fresh CI43620888565](https://github.com/TalhanAhmad/ERP-SYSTEM/actions/runs/43620888565):64 fresh migrations,865 tests and both builds/type/lint/docs. F31 local acceptance is complete; separate publication/CI is recorded in the continuation tracker.


F31 source18c631e47184891973e74b5910046bd838d09a0c passed [fresh CI43624960483](https://github.com/TalhanAhmad/ERP-SYSTEM/actions/runs/43624960483):66 fresh migrations,882 tests and both builds/type/lint/API checks. F32 local acceptance is complete; separate publication/CI is recorded in the continuation tracker.


F32 source912634c7d44689cee05ded37bc805a17fabb263a passed [fresh CI43714158210](https://github.com/TalhanAhmad/ERP-SYSTEM/actions/runs/43714158210):68 fresh migrations,902 tests and both builds/type/lint/API checks. F33 local acceptance is complete; separate publication/CI is recorded in the continuation tracker.


F33 source18c8358bbd30eb2a48348090c9fba7b994c71386 passed [fresh CI43716796463](https://github.com/TalhanAhmad/ERP-SYSTEM/actions/runs/43716796463):70 fresh migrations,921 tests and both builds/type/lint/API checks. F34 local acceptance is complete; separate publication/CI is recorded in the continuation tracker.


F34 sourceca6b25da5f67af86f048f9bdf2328a6ee92314c5 passed [fresh CI43723662717](https://github.com/TalhanAhmad/ERP-SYSTEM/actions/runs/43723662717):71 fresh migrations,940 tests and both builds/type/lint/API checks. F35 local acceptance is complete; separate publication/CI is recorded in the continuation tracker.


F35 source4b4058f162b371b454200de22f12166e79a45969 passed [fresh CI43729128979](https://github.com/TalhanAhmad/ERP-SYSTEM/actions/runs/43729128979):72 fresh migrations,962 tests and both builds/type/lint/API checks. F36 development and full acceptance are in progress.


F36 local acceptance is complete; separate source/fresh CI is recorded in the continuation tracker.
