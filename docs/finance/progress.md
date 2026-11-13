# Finance progress

Updated: 13 November 2026 (Asia/Karachi). Engineering acceptance remains separate from the original ERP/learning roadmap; no effort hours asserted.

**F01–F14 complete: 14 of 48 finance milestones; 34 remain.** F12 adds invoice screens/private PDF and F13 receipts/partial/multiple allocations. F14 adds client advances and later applications without duplicate cash. Current user request authorizes F15 credits/refunds/reversals next, with a separate commit/push for each. See [current delivery record](delivery-F12-F15.md). F11 evidence below remains historical.

F11 introduces typed invoice/line sources, exact per-line discounts/rounding, nonreused server numbers and private create/edit/post/void/register/detail APIs. One private emitter now handles manual journals and invoices. Posting atomically writes AR debit and earned/deferred credits, frozen contact evidence, dated receivable/BILLED events, usage and restricted permanent receipt/audit. Posted sources/events are immutable; generic journals cannot bypass deferred recognition controls. See [F11 delivery](delivery-F11.md), [exact results](testing/F11-results.md) and [invoice design](accounting/invoices.md).

535 distinct local tests passed: 207 unit + 299 real PostgreSQL integration + 29 Chromium browser. Strict typing/lint and local production build passed; Supabase-mode production build also passed; final report/publication evidence is in F11 results. The browser API journey is not an F12 editor/PDF claim. All 33 concrete finance API paths are documented. Current branch finance/invoices-f11; draft PR #2 is published and exact-source CI passed.

The isolated test schema has **28 additive migrations**. Hosted ERP's last verified schema remains 17 with finance disabled; this milestone performed no hosted finance migration, grant/owner setup, real chart/year/opening balance import or deployment. F13+ settlement/credits/tax, F42 recognition caps/jobs, statements/closing and full representative accounting acceptance remain pending.

F01–F10 were merged through [PR #1](https://github.com/TalhanAhmad/ERP-SYSTEM/pull/1) at 7d9ca2e19b1b912b8b65cb2f2d24bc94def7abde on 12 November 2026. Its merge commit preserved ten individual commits. Historical source 4be8c72 passed [CI 43238001511](https://github.com/TalhanAhmad/ERP-SYSTEM/actions/runs/43238001511) with 488 tests; final tracking 9256e8b passed [CI 43239515265](https://github.com/TalhanAhmad/ERP-SYSTEM/actions/runs/43239515265). That evidence covers prior scope, not this new source.

Company chart/fiscal year/cutover, tax/recognition/asset policies, hosted owner MFA-device setup, representative dataset/accountant review and separate launch acceptance remain open. F10's historical remaining planning range was 240–340 focused engineering hours; no new elapsed effort or delivery date is asserted. All 60 original learner demonstrations remain separate and pending.


## F11 publication evidence

[CI 43399849090](https://github.com/TalhanAhmad/ERP-SYSTEM/actions/runs/43399849090) passed on source d74828436b29026e3b76a3fceea27b81047cd0e6: all 28 additive migrations on fresh PostgreSQL, 207 unit + 299 PostgreSQL integration + 29 Chromium browser tests (**535**), strict typing/lint, local and Supabase-mode production builds and documentation. Source is pushed in [draft PR #2](https://github.com/TalhanAhmad/ERP-SYSTEM/pull/2) on finance/invoices-f11; no merge or hosted finance release was performed.
