# Finance owner review pack — preparation in progress

Prepared for Talha Ahmad, as requested on 14 November 2026. Intended Finance Owner: zablerkhanahmad@gmail.com. This identifies the intended owner only; no live finance grant or configuration is implied.

## Current evidence and scope

F01–F25 are implemented and merged through PR3, merge b83951d280361b44a57d93b8c8f01e9109096e65. Exact-head CI43584464377 passed before merge. F26 source4b0e4a6 passed fresh CI43599585247. F27 source9e23dfc passed CI43604433797. F28 reviewed cost/project result engineering is locally verified with818 checks; publication is recorded in the continuation tracker. F29 is now locally accepted with838 checks; F30–F46 remain pending. This preparation does not mark F47 human review or F48 acceptance/release complete.

The final pack will include tested representative statements, source-to-ledger links, dated balances, exception cases, migration/recovery evidence and outstanding decisions. No company figures, legal compliance or accountant approval are inferred from synthetic fixtures.

## Decisions to review before real books

| Decision | Current application position | Owner response |
| --- | --- | --- |
| Reporting currency | PKR-only initial accounting | Pending |
| Chart/report mapping | Explicit reviewed masters; synthetic test mappings are not company adoption | Pending |
| Fiscal year and cutover | No live fiscal year or opening books adopted | Pending |
| Tax and withholding | Optional, effective-dated reviewed mappings; no real rates assumed | Pending |
| Depreciation convention | Pending by default; full-month straight line requires explicit first month and evidence | Pending |
| Investment measurement | Requires reviewed holding policy/mappings; no automatic market values | Pending |
| Funding classification | Capital, founder-payable and distributions are distinct source types | Pending |
| Finance selection and owner security | Current ACTIVE Super Admin plus explicit grant; fresh verification for writes | Pending |
| Private evidence/scanner | Separate private bucket and signed clean attestation; live scanner not configured | Pending |
| Cutover import/reconciliation/closing | Later milestone acceptance still required | Pending |

## Verified F26 synthetic example

Purchase cost100.01, residual0.01, three confirmed full months: draft charges33.33,33.33,33.34. Posting retains residual0.01. Generation alone posts nothing. After the first charge, carrying value66.68; a nil-proceeds disposal debits accumulated depreciation33.33 and loss66.68, credits asset cost100.01, and has no cash leg. Its dated reversal restores the original asset position while retaining both sources. Impairments/adjustments require prospective policy review before further charges.

These are verification values only, not company policy or real transactions. [F26 verification](../testing/F26-F48-results.md) records779 distinct local checks; later representative statements remain pending.

## Owner review record

Reviewer: pending. Review date: pending. Reviewed source commit and report snapshot: pending. Accepted policies: pending. Questions/gaps and responsible person: pending. Decision to accept engineering: pending. Separate decision to enable live finance/import real books: pending.

A completed engineering test does not fill these human decision fields. The pack is prepared for the user; an accountant’s involvement or sign-off is not claimed.


## Commercial review example through F27

A synthetic signed agreement100.01 plus a separately approved increase20.02 gives a current commercial value120.03. Confirming a50.00 billing plan creates no revenue/receivable/cash. A later real posted invoice line10.01 can be linked for traceability; release preserves its original net/snapshot and changes no GL. Original linked net is labelled before subsequent credits. Actual earned revenue and project costs are based on posted accounting activity, with F28 result calculations now based on actual posted GL. No actual company agreement or approval is asserted.


F27 separate publication verified: source9e23dfc36b472ac540617245df753cb9292445de passed [fresh CI43604433797](https://github.com/TalhanAhmad/ERP-SYSTEM/actions/runs/43604433797), including60 fresh migrations, all798 tests, both builds/type/lint/142-path docs. F28 engineering and final verification are in progress; [cost-allocation rules](../accounting/cost-allocation.md) describe the implemented boundary.


## Reviewed project-cost example through F28

A synthetic unpaid supplier bill120.00 recognizes cost before cash payment. A reviewed70.00/20.00/30.00 project/project/shared split debits the same expense account on targets and credits its original dimension; company expense and payable remain120.00. A subsequent credit first requires compatible allocation correction, including historical dates. Three paisa split50/50 preview0.02 and0.01 deterministically. An earned project invoice300.00 and assigned direct cost120.00 give contribution180.00; advance billing100.01 is net invoiced but zero earned income. Shared company overhead is shown separately, not deducted twice.

These are verification fixtures, not company figures or accepted policy. 818 distinct local checks passed:256 unit (3.05s),515 PostgreSQL integration (209.95s),47 Chromium (2.8m). Both production builds, strict typing/lint,152 concrete finance API paths/verbs/references and all61 applied migration checksums passed. Final Word/private-value verification accompanies separate publication; fresh F28 CI will be observed after push. Budget plans, attributed cash, statements, cutover/closing and final recovery evidence remain later milestones. Review/acceptance fields remain pending for the user.


F28 source2c3b0031e87fab2a63e0445118e216e7f61718ca passed [fresh CI43609969834](https://github.com/TalhanAhmad/ERP-SYSTEM/actions/runs/43609969834):61 migrations, all818 tests, both builds/type/lint/152-path API verification. F29 local acceptance is complete; source publication/fresh CI are recorded separately.


## Budget and forecast example through F29

A synthetic approved monthly expense budget100.01 and actual unpaid incurred cost120.00 show remaining−19.99, with an advisory warning; the actual expense is still recognized. Drafting a130.03 revision leaves100.01 current until explicit approval, then retains the old plan as superseded. A separate expected payment200.02 dated2099-12-31 can be edited/cancelled/reopened with likelihood notes and creates no cash or GL event. These are verification fixtures, not company budgets or payment commitments.

838 distinct local checks passed:259 unit (3.35s),531 PostgreSQL integration (214.90s),48 Chromium (2.9m). The new budget/revision/variance/selected-forecast journey passed4.7s, including manager denial, mobile and WCAG. Strict typing/lint, both production builds,162 concrete API paths/verbs/references and all63 applied migration checksums passed. Word/private-value verification accompanies separate F29 publication; fresh CI will be observed after push. Statement imports, matching/reconciliation, statements/exports, closing/cutover and final recovery evidence remain later milestones. Review/acceptance fields stay unfilled for the user.
