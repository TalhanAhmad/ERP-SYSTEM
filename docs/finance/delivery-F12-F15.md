# Encova Finance F12–F15 delivery report

Completed engineering acceptance on 13 November 2026 (Asia/Karachi). Talha explicitly requested completing through F15 and committing/pushing each milestone separately. This is an extension of the existing Next.js/Supabase/Vercel architecture. No effort hours, learner demonstration or accountant approval is invented.

## Delivered by milestone

| Milestone | Result | Separate source commit / CI |
| --- | --- | --- |
| F12 | Invoice register/editor/line preview and private posted PDF | abf7c6ccc0492414aeb9db8635f8eab7ae9652f5; CI 43407757976 passed |
| F13 | Partial/multiple receipt allocations and explicit fees | 1e8c8dc4e5d95ee6db36c950a59e71f06695bd40; CI 43409706332 passed |
| F14 | Unallocated/mixed client advances and later application without duplicate cash | b141833be6fd1d21f363c3f1cbbac9edff09ec10; CI 43412224862 passed |
| F15 | Capped customer credits, refunds, dated reversals and settlement release | b5a424bc42121a185da4d44d857e5ad59040107b; CI 43419008430 passed |

## F12 — invoice screens and private PDF

Built editable invoice lines, exact independent BigInt previews, paginated client/project/typed-account search, register filters/detail, draft edit/post/void and frozen posted contact preview. Uncertain create-response retries preserve the request key and create one source. Only posted invoices download as private authenticated PDFs; finance access is held during generation. Bundled licensed Noto Sans is traced into Vercel function output. Long invoices paginate; no public download URL or automatic email.

Local acceptance: 208 unit/301 PostgreSQL integration tests, strict typing/lint, both production builds and real browser create/retry/edit/post/PDF/mobile WCAG. Source was committed and pushed before F13; its full fresh-runner CI passed all 30 browser cases.

## F13 — actual client receipts

Added typed receipt/allocation sources, private register/editor/detail and exact cash-plus-fee settlement. Receipts may partially settle one invoice or cover several; the original invoice total remains immutable. The shared engine writes actual cash/fee debits and AR credits plus dated settlement events. Current and all later effective balances are reserved, preventing concurrent/backdated over-allocation. Archived invoice projects can settle; no duplicate revenue.

Local acceptance: 212 unit/314 integration tests,70 focused accounting checks, strict typing/lint, both builds and multi-invoice/fee/mobile browser journey (4.3 seconds). Additive29 created the sources;30/31 corrected a loop-record/alias collision and a nonexistent cash-master usage write. Cash mappings already freeze through their GL usedAt marker. No failed posting committed, reset or applied-checksum rewrite. Separate source push and complete 31-browser/fresh 31-migration CI passed.

## F14 — held advances and applications

Receipts can hold unallocated or mixed client money in a protected liability. Typed immutable source-pool events identify the original held funds. An application transfers eligible liability to invoice AR with no second bank entry or new revenue. Same-party/source/date mappings and current/later capacities prevent over-application, including races and backdating. Searchable source choices and previews show current available funds.

Local acceptance: 214 unit/322 integration tests, all 11 finance browser journeys (36.3 seconds; new advance journey 3.6 seconds), typing/lint and both builds. Migration 32 initially failed CASE parsing transactionally; corrected unapplied SQL passed an explicit ROLLBACK rehearsal, only its failed attempt was resolved, and deployment succeeded. Separate source push and complete 32-browser/fresh 32-migration CI passed.

## F15 — credits, refunds and dated corrections

Credit notes reference original invoice lines and are capped by eligible discounted net amounts across all effective dates. Earned credits reverse original revenue; deferred credits reduce the liability rather than recognizing income. The immutable posting-time split reduces AR first and creates refundable customer credit for a paid portion, even when payment occurred after the credit draft was saved. A forged otherwise balanced split is rejected at commit.

Refunds debit available client liability and credit actual bank/cash, with no expense or AR duplication. Held credit can also apply to another invoice of the same client. Dated source reversals retain the original records and reverse their exact GL/AR/fund/credit/deferred effects only on the correction date. Consumed source money must be restored first.

A separate whole-settlement release keeps cash while moving every original invoice allocation once into a new held-funds pool. Its dated reversal checks both pool and invoice capacity. An active release must reverse before a whole receipt reverses. There is no arbitrary partial release or deletion of history.

Added accessible registers, editors, preview/correction forms, searchable eligible lines/funds, posted private credit-note PDF, invoice credit links and visible original/reversal journals. Credentials clear after every submission and never enter receipts/audit/PDF/retry data. Only current selected finance administrators can access any of these records. Generic journals cannot bypass protected controls.

Migration 33 passed a transactional ROLLBACK rehearsal and its first actual deployment to encova_test. Earlier applied migrations remain unchanged. Hosted finance is still disabled.

## Verification

Final local total **596 distinct tests**:216 unit + 346 real PostgreSQL integration + 34 Chromium browser. Strict typing/lint, local and Supabase-mode production builds passed. Browser suite took2.0 minutes; new credit/PDF/refund/reversal journey 6.6 seconds, settlement-release/dated undo journey 4.2 seconds. All original ERP HR/attendance/announcement/assignment/attachment/security journeys passed. Every60 concrete finance API path/exported verb/local OpenAPI reference matches. PDF fonts are present in both Next function traces. Word/private-value/local-link validation precedes push.

[Exact results and commands](testing/F12-F15-results.md) · [Posting and correction rules](accounting/customer-cycle.md) · [Full step log](../work-log.md).

## What remains

**15 of 48 finance engineering milestones complete; 33 remain.** Next F16: bills, immediate expenses and category/project splits. Later work includes supplier flows, configurable tax/withholding, financial attachments, treasury/funding/assets/investments, statements/ageing/exports, closing/opening books/jobs and full representative/accountant acceptance. Current registers are source-document views, not final financial statements. All 60 original ERP learner demonstrations remain separate and pending.

Company chart/fiscal year/cutover/policies, live owner/MFA setup and a separate finance release decision remain open. This delivery performed no hosted finance migration/grant/enablement, real financial seed, deployment, automatic client email or PR merge.

## Publication

[CI 43419008430](https://github.com/TalhanAhmad/ERP-SYSTEM/actions/runs/43419008430) passed on exact source **b5a424bc42121a185da4d44d857e5ad59040107b**: all 33 migrations on fresh PostgreSQL, 216 unit + 346 integration + 34 Chromium tests (**596**), strict typing/lint, local and Supabase-mode production builds and documentation/API verification. Each requested milestone was committed/pushed separately; [draft PR #2](https://github.com/TalhanAhmad/ERP-SYSTEM/pull/2) now covers F11–F15 on finance/invoices-f11. No merge or hosted finance release occurred.

[Focused Word report](Encova_F12-F15_Report.docx) · [Full progress Word report](../Encova_Progress_Report.docx).
