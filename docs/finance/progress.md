# Finance progress

Updated: 12 November 2026 (Asia/Karachi). Engineering acceptance is separate from the original ERP/learning roadmap; no effort hours asserted.

**F01–F10 complete: 10 of 48 finance milestones; 38 remain.** Talha explicitly authorized completing through F10. Next is F11: earned/deferred invoice schema and typed posting services.

F06–F08 add ordinary manual journal drafts/posting, PostgreSQL deferred balancing/source/immutability guards, atomic first-use markers, permanent request/source identities, versions, batch void, dated reversals and an exact core accounting subset. F09 supplies shared registers, full-filter original totals, drawer draft editing, keyboard/mobile/retry states and searchable account choices. F10 adds owner-managed parties/cash mappings and chart UI. Current selected finance administrators may post ordinary journals; setup remains owner-only.

488 distinct local tests: 185 unit, 275 real PostgreSQL integration and 28 Chromium browser. Strict typing/lint and both local/Supabase-mode production builds passed. All 29 concrete finance OpenAPI paths/verbs/references were checked. Updated Word reports and synthetic mobile evidence accompany the source. Source 4be8c72eed903d2acd7b22be793a76bba638c55a is committed/pushed; [CI 43238001511](https://github.com/TalhanAhmad/ERP-SYSTEM/actions/runs/43238001511) passed the full fresh-database verification.

The isolated test schema has **27 additive migrations**; hosted ERP remains on 17 with finance disabled. No hosted grant/owner setup, financial migration, real chart/fiscal year/opening balance, manual financial deployment occurred. Protected controls cannot be posted through generic manual journals. Invoices/payments/subledgers, cash movements, financial statements and close/reopen remain future milestones; the tested core subset is not the full end-to-end accounting fixture.

Current branch: main; source branch finance/foundation was merged through [PR #1](https://github.com/TalhanAhmad/ERP-SYSTEM/pull/1). Prior F05 source 109a83c passed CI 43215176008; it is historical evidence, not F10 verification. Exact new publication evidence is in [results](testing/F06-F10-results.md).

[Focused F06–F10 report](delivery-F06-F10.md) · [milestones](planning/milestones.md) · [ledger design/estimate](accounting/ledger-core.md) · [decisions](decisions.md) · [risks](risks.md).

Company/accountant policies, chart/fiscal year/cutover, live MFA-device setup, representative reports and separate launch acceptance remain open. At F10 the working remaining planning range is 240–340 focused engineering hours, excluding external waiting; no completion date or actual time spent is claimed. Original learner demonstrations remain pending.

## Final publication evidence

Exact-source [CI 43238001511](https://github.com/TalhanAhmad/ERP-SYSTEM/actions/runs/43238001511) passed on 4be8c72eed903d2acd7b22be793a76bba638c55a: 185 unit +275 PostgreSQL integration +28 Chromium browser tests (**488**), all27 migrations applied to fresh PostgreSQL, strict typing/lint, local and Supabase-mode production builds and documentation. CI browser suite passed in2.2 minutes; the complete verify job took5m19s. Source was pushed on finance/foundation; PR#1 is now merged into main at 7d9ca2e. Hosted ERP retains17 migrations with finance disabled; no live finance migration/grant or deployment occurred.

The final tracking commit updates documentation/Word evidence only. Its documentation links, Word ZIP/XML/images/private-value checks are validated before push; the passing source CI above covers the unchanged application/schema source.

## PR merge — 12 November 2026

PR #1 was merged into main at 2026-11-12 15:17:24 UTC (20:17 Pakistan time), after Talha explicitly requested the merge. Merge commit: 7d9ca2e19b1b912b8b65cb2f2d24bc94def7abde. A merge commit preserved all ten individual finance commits and their original attribution. PR-head 9256e8b had passing CI 43239515265 before merging. Local main was fast-forwarded to the merged result; application/schema content is unchanged from the verified PR head. Finance remains disabled by default; no manual hosted migration or enablement was performed.
