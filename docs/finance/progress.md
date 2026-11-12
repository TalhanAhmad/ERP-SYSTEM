# Finance progress

Updated: 12 November 2026 (Asia/Karachi). Engineering acceptance is separate from the original ERP/learning roadmap; no effort hours asserted.

**F01–F10 complete: 10 of 48 finance milestones; 38 remain.** Talha explicitly authorized completing through F10. Next is F11: earned/deferred invoice schema and typed posting services.

F06–F08 add ordinary manual journal drafts/posting, PostgreSQL deferred balancing/source/immutability guards, atomic first-use markers, permanent request/source identities, versions, batch void, dated reversals and an exact core accounting subset. F09 supplies shared registers, full-filter original totals, drawer draft editing, keyboard/mobile/retry states and searchable account choices. F10 adds owner-managed parties/cash mappings and chart UI. Current selected finance administrators may post ordinary journals; setup remains owner-only.

488 distinct local tests: 185 unit, 275 real PostgreSQL integration and 28 Chromium browser. Strict typing/lint and both local/Supabase-mode production builds passed. All 29 concrete finance OpenAPI paths/verbs/references were checked. Updated Word reports and synthetic mobile evidence accompany the source. Publication and exact-source clean-runner CI are pending; local evidence below is complete.

The isolated test schema has **27 additive migrations**; hosted ERP remains on 17 with finance disabled. No hosted grant/owner setup, financial migration, real chart/fiscal year/opening balance, deployment or merge occurred. Protected controls cannot be posted through generic manual journals. Invoices/payments/subledgers, cash movements, financial statements and close/reopen remain future milestones; the tested core subset is not the full end-to-end accounting fixture.

Working branch: finance/foundation; [draft PR #1](https://github.com/TalhanAhmad/ERP-SYSTEM/pull/1). Prior F05 source 109a83c passed CI 43215176008; it is historical evidence, not F10 verification. Exact new publication evidence is in [results](testing/F06-F10-results.md).

[Focused F06–F10 report](delivery-F06-F10.md) · [milestones](planning/milestones.md) · [ledger design/estimate](accounting/ledger-core.md) · [decisions](decisions.md) · [risks](risks.md).

Company/accountant policies, chart/fiscal year/cutover, live MFA-device setup, representative reports and separate launch acceptance remain open. At F10 the working remaining planning range is 240–340 focused engineering hours, excluding external waiting; no completion date or actual time spent is claimed. Original learner demonstrations remain pending.
