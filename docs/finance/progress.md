# Finance progress

Date: 11 November 2026 (Asia/Karachi). Separate from the original ERP progress.

Current delivery: F01–F03 complete (3 of 48 acceptance groups); 45 remain. Next: F04 controlled ownership. The assessment, feature gate/documentation and current-account/grant access boundary are verified. Do not interpret this as a working ledger or a live finance launch. No hours are asserted.

Owner selection is confirmed; owner setup/transfer remains pending F04. Finance is disabled by default. Only the isolated test database has received migration 18. The hosted ERP retains 17 migrations and its existing deployment.

See [test results](testing/results.md), [milestones](planning/milestones.md), [open decisions](decisions.md) and [risks](risks.md). Next: F04 controlled owner bootstrap/transfer/revoke, last-owner/generic-admin takeover protections and fresh MFA/reauthentication, before accounts/posting. Source 6a82a27 is committed and pushed on finance/foundation; draft review: https://github.com/TalhanAhmad/ERP-SYSTEM/pull/1. CI attempt 1 passed through the build, then the Ubuntu mirror DNS failure blocked browser dependency installation. Attempt 2 stalled at the same install and was canceled. The CI runner is now pinned to Ubuntu 24.04 with its preinstalled shared libraries; browser installation and all test cases remain required. Replacement CI is pending; success is not claimed yet. No merge/live finance migration occurred.
