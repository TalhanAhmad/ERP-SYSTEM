# Finance progress

Updated: 12 November 2026 (Asia/Karachi); F04 work began 11 November. Separate from the original ERP progress.

Current delivery: F01–F04 complete (4 of 48 acceptance groups); 44 remain. Next: F05 accounts, periods and PKR validation. The assessment, feature gate/documentation and current-account/grant access boundary are verified. Do not interpret this as a working ledger or a live finance launch. No hours are asserted.

The intended owner identity is confirmed. F04 owner controls are implemented and locally verified; actual hosted ownership setup remains pending. Finance is disabled by default. The isolated test database has received migrations 18–20. The hosted ERP retains 17 migrations and its existing deployment.

See [test results](testing/results.md), [milestones](planning/milestones.md), [open decisions](decisions.md) and [risks](risks.md). F04 now implements controlled bootstrap/recovery, owner-only grants/revokes, transfer acceptance/cancellation, database owner/identity protections, fresh password plus hosted TOTP, and the access screen. Final local verification passed 369 tests, strict typing/lint and both production builds. Source publication/CI is underway. Accounts/posting remain subsequent work. Application source 6a82a27 and CI-environment correction 02c26a7 are committed/pushed on finance/foundation. [Draft PR #1](https://github.com/TalhanAhmad/ERP-SYSTEM/pull/1) is unmerged. [CI 43058677199](https://github.com/TalhanAhmad/ERP-SYSTEM/actions/runs/43058677199) passed on 02c26a7: all 348 tests, both builds, typing/lint and docs. Earlier runner DNS failure/canceled retry and its correction are retained in testing/results.md. No live finance migration/enablement occurred.
