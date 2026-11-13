# Finance progress

Updated 13 November 2026 (Asia/Karachi). Engineering acceptance remains separate from the original ERP/learning roadmap; no effort hours asserted.

**F01–F15 complete:15 of 48 finance milestones; 33 remain.** Talha explicitly requested completion through F15 and a separate commit/push for each milestone. Next is F16: bills, immediate expenses and category/project splits.

F12 supplies invoice screens/line previews/private posted PDF. F13 supplies partial/multiple receipts and explicit fees. F14 supplies unallocated/mixed advances and later applications without duplicate cash. F15 supplies capped original-line credits, paid-credit liability/refunds, dated reversals and whole settlement release while retaining cash. Typed sources, dated events, snapshots, private access and the one balanced engine remain enforced. See [delivery report](delivery-F12-F15.md), [exact verification](testing/F12-F15-results.md) and [customer accounting rules](accounting/customer-cycle.md).

Final local verification: **596 tests** (216 unit + 346 real PostgreSQL integration + 34 Chromium browser), strict typing/lint and both local/Supabase-mode production builds passed. Full browser 2.0 minutes, including all original ERP journeys. All 60 concrete finance API paths/verbs/references are verified; Word/private-value and local-link checks accompany publication.

Separate pushes: F12 abf7c6c (CI 43407757976 passed), F13 1e8c8dc (CI 43409706332 passed), F14 b141833 (CI 43412224862 passed). F15 b5a424bc passed CI 43419008430 on a fresh runner with all 596 tests and 33 migrations. Branch finance/invoices-f11, existing draft PR #2 expands to F11–F15; no merge is implied.

Test schema:33 additive migrations. Hosted ERP's last verified17-migration schema and disabled finance are untouched by this delivery. No real chart/year/cutover/opening books, hosted owner/grant/MFA setup, financial deployment, automatic client email or launch occurred. The designated intended owner remains the existing zablerkhanahmad@gmail.com account; synthetic tests do not configure live ownership.

F16–F48 remain, including suppliers/expenses, configurable tax/withholding, financial attachments, cash/funding/assets/investments/projects, reconciliation/statements/exports, closing/opening books/jobs, complete F43 fixtures and company/accountant/release acceptance. Register totals are source views, not financial statements. All 60 original learner demonstrations remain separate and pending.

Historical F01–F10 was merged through PR #1 at7d9ca2e on 12 November 2026. F11 source d748284 passed CI 43399849090. Their records remain in prior focused reports; they are not used as final F15 source verification.


## Final F15 publication

[CI 43419008430](https://github.com/TalhanAhmad/ERP-SYSTEM/actions/runs/43419008430) passed on exact source **b5a424bc42121a185da4d44d857e5ad59040107b**: all 33 migrations on fresh PostgreSQL, 216 unit + 346 integration + 34 Chromium tests (**596**), strict typing/lint, local and Supabase-mode production builds and documentation/API verification. Each requested milestone was committed/pushed separately; [draft PR #2](https://github.com/TalhanAhmad/ERP-SYSTEM/pull/2) now covers F11–F15 on finance/invoices-f11. No merge or hosted finance release occurred.
