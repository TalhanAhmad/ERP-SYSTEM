# Finance progress

Updated: 12 November 2026 (Asia/Karachi). Separate from the original ERP roadmap; no effort hours asserted.

F01–F05 implementation acceptance is complete: **5 of 48 finance milestones; 43 remain**. F05 adds retained accounts, explicit inclusive periods and exact PKR validation, with owner-only setup and selected-administrator reads. It creates no monetary entries or company chart/fiscal year. Next: **F06 posting engine and database balancing/immutability safeguards**.

Local acceptance: **424 distinct tests** (167 unit, 231 PostgreSQL integration, 26 Chromium browser), strict typing/lint, local and Supabase-mode production builds, documentation/OpenAPI checks and Word export. Final review added four amount edge cases; affected unit/backend checks and local build passed again. Final setup-browser repeat (5.0 seconds) and Supabase build also passed; publication/CI evidence is recorded in [test results](testing/results.md).

The isolated test schema has 22 additive migrations. Hosted ERP retains 17, its current deployment and persistent credentials. Finance remains disabled by default; the intended owner is confirmed but no hosted owner/grant, live finance migration, real accounting seed, merge or deployment occurred. Company chart/fiscal year/accounting policies, MFA-device setup and separate finance launch acceptance remain open.

Source is being published on finance/foundation in [draft PR #1](https://github.com/TalhanAhmad/ERP-SYSTEM/pull/1). F05 clean-runner verification is pending; do not interpret prior CI as F05 evidence. F04 source 9fea005624c8c734659e289da85d114499482cfd passed [CI 43173242785](https://github.com/TalhanAhmad/ERP-SYSTEM/actions/runs/43173242785) with 369 tests. Earlier F01–F04 failure/recovery evidence is retained in testing/results.md.

See [milestones](planning/milestones.md), [decisions](decisions.md), [setup/money rules](accounting/setup-and-money.md) and [risks](risks.md). Ledger, settlements, subledgers, financial statements and actual closing remain future milestones. The original ERP learning record is unchanged; Talha's learner demonstrations are not inferred from implementation.
