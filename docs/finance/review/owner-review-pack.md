# Finance owner review pack — preparation in progress

Prepared for Talha Ahmad, as requested on 14 November 2026. Intended Finance Owner: zablerkhanahmad@gmail.com. This identifies the intended owner only; no live finance grant or configuration is implied.

## Current evidence and scope

F01–F25 are implemented and merged through PR3, merge b83951d280361b44a57d93b8c8f01e9109096e65. Exact-head CI43584464377 passed before merge. F26 source4b0e4a6 passed fresh CI43599585247. F27 source9e23dfc passed CI43604433797. F28 reviewed cost/project result engineering is locally verified with818 checks; publication is recorded in the continuation tracker. F29 is now locally accepted with838 checks; F30 is now locally accepted with865 checks; F31 is locally accepted with882 checks; F32 is locally accepted with902 checks; F33 is locally accepted with921 checks; F34 is locally accepted with940 checks; F35 is locally accepted with962 checks; F36 is locally accepted with985 checks; F37–F46 remain pending. This preparation does not mark F47 human review or F48 acceptance/release complete.

The final pack will include tested representative statements, source-to-ledger links, dated balances, exception cases, migration/recovery evidence and outstanding decisions. No company figures, legal compliance or accountant approval are inferred from synthetic fixtures.

## Decisions to review before real books

| Decision | Current application position | Owner response |
| --- | --- | --- |
| Reporting currency | PKR-only initial accounting | Pending |
| Chart/report mapping | Explicit reviewed masters; synthetic test mappings are not company adoption | Pending |
| Bank-credit presentation | UNREVIEWED until explicit owner choice; synthetic tests do not adopt company policy | Pending |
| Income-tax expense presentation | Explicit eligible expense-account mapping; no guessed rate/VAT/withholding classification | Pending |
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


F29 sourcea6b014b9f03ad70e62c8cff3733a4e6070ad3bec passed [fresh CI43612791776](https://github.com/TalhanAhmad/ERP-SYSTEM/actions/runs/43612791776):63 migrations, all838 tests, both builds/type/lint/162-path documentation checks. F30 local acceptance is complete; separate publication/fresh CI are recorded in the continuation tracker.


## Statement-source example through F30

A synthetic CSV with one money-in record10.01, opening0.00 and closing10.01 validates its source totals. Closing10.00 yields−0.01 and cannot be confirmed. Exact re-import returns its original source; a different file with the same possible transaction requires explicit review and retains both records. Void/replacement keeps the original file and row identities. None of these actions creates a journal or establishes that the posted bank balance is reconciled. Matching and reconciliation remain F31/F32 work.

A4,780,034-byte/5,000-record file was actually transferred and retained through bounded requests, with exact50.00 total and record5,000 verified. CSV bytes remain private structured input in PostgreSQL; they are not public downloadable attachments. Retention/archival and actual bank master metadata remain owner review decisions. 865 distinct local checks passed:267 unit,549 actual PostgreSQL integration (216.85s),49 Chromium (2.8m). The statement journey passed6.8s and6.3s in full regression, including balance-error recovery, exact re-import, duplicate review, retained replacement, selected writer, employee denial, mobile and WCAG, without GL. Both production builds, strict typing/lint,173 concrete API paths/verbs/references and all64 applied migration checksums passed. Word/private-value checks accompany separate F30 publication; fresh CI is observed after push. Review/acceptance fields remain unfilled for the user.


## Matching review example through F31

A retained synthetic bank deposit10.01 can match two actual cash receipts4.00 and6.01, or two statement records4.00/6.01 can match one cash receipt10.01. Both sides reach exactly0.00 remaining; any0.01 excess fails. Cash posting and bank value dates remain explicit, with each allocation effective on the later date. Undoing the group retains both decisions and restores residual capacity without posting cash. Active matches prevent reversal/void of their original cash/statement source. Nonposting matching retains its effective period.

882 distinct local checks passed:270 unit,562 actual PostgreSQL integration (229.33s (tests 96%, import 4%)),50 Chromium (2.9m). All66 applied migration checksums, strict typing/lint, both production builds and178 concrete API paths/verbs/references passed. Matching browser acceptance covers excess-amount recovery, actual cash/value dates, explicit confirmation, retained unmatch, no additional GL, mobile/WCAG and employee denial. Full/focused Word and private-value checks accompany separate F31 publication; fresh CI is observed after push. These are synthetic associations, not a finalized bank reconciliation; F32 proof follows. Owner acceptance fields remain unfilled.


## Bank proof example through F32

A synthetic actual cash receipt10.01 with only4.00 on the bank statement has a6.01 deposit in transit. The exact equation4.00+6.01−0.00−10.01=0.00 alone is insufficient: the outstanding6.01 requires an explanation. A partial payment uses the corresponding subtraction. Unresolved receipt/payment rows cannot be hidden by netting; a genuine duplicate retains its row and needs an explicitly reviewed fully matched original peer.

Finalization retains company/PKR/basis/cutoff/source/notes metadata. Owner reopening supersedes the issued proof without changing it, and a linked replacement keeps the full chain. New historical cash, original-date matching changes or contradictory no-activity evidence cannot silently alter the issued bank proof. An empty bank can use genuine equal opening/closing evidence without a fabricated cash row. These are synthetic verification values, not company books or accountant approval.

902 distinct local checks passed:273 unit,578 actual PostgreSQL integration (248.88s),51 Chromium (3.3m). Both production builds, strict typing/lint,186 concrete API paths/verbs/references and all68 applied migration checksums passed. The new reconciliation browser journey passed4.6s and3.9s in full regression, including partial cash documentation, finalization, retained owner reopen/replacement, no added GL, mobile/WCAG and employee denial. Full/focused Word/private-value checks accompany separate F32 publication; fresh CI is observed after push. Human review fields remain unfilled.


## Posted ledger and trial balance example through F33

A synthetic opening debit balance10.01 plus27 actual1.00 receipts closes37.01. The first page ends35.01 and the next page carries36.01/37.01, without resetting the opening or running balance. Dated reversals stay in their own actual posting range and link back to original sources; typed reversal action may be POST. Future/voided drafts contribute nothing.

A displayed single account can have a debit or credit balance; complete company opening/movement/closing trial totals still include all posting accounts and remain separately balanced. Search, zero-row display and pagination do not shrink company totals. Archived controls retain actual history. An empty future report range carries prior posted opening to closing; no projected income or cash is invented. Exact paisa survives aggregates larger than the individual document range.

921 distinct local checks passed:276 unit,593 actual PostgreSQL integration (275.65s),52 Chromium (3.2m). Both production builds, strict typing/lint,189 concrete API paths/verbs/references and all70 applied migration checksums passed. The new ledger browser journey passed6.4s, including second-page running carry, real source navigation, complete company trial totals under display filters, readonly/private employee denial and mobile/WCAG. Full/focused Word/private-value checks accompany separate F33 publication; fresh CI is observed after push. These are synthetic verification values, not reviewed company figures. Human acceptance fields remain unfilled.


## Financial statement review example through F34

A synthetic earned invoice100.01 plus deferred billing40.00 creates receivables140.01 but earned revenue100.01. An unpaid direct-cost bill60.00 creates a liability60.00 and actual profit40.01, with no claimed cash receipt/payment. Assets140.01 equal liabilities100.00 plus unclosed profit40.01. Prepayments/assets stay outside immediate expense; contra asset credits reduce assets and the actual expense reduces the unclosed result.

Another synthetic invoice100.01 less direct cost60.00 and recorded ordinary tax expense7.00 yields net33.01. Explicitly mapping that7.00 to the tax-expense presentation changes its statement line once and leaves net profit/GL unchanged. A negative bank asset needs explicit presentation review; a reviewed current-liability presentation changes classification while preserving the exact balance equation. None of these simulated choices adopts real company policy.

940 distinct local checks passed:279 unit,608 actual PostgreSQL integration (279.23s),53 Chromium (3.3m). Both production builds, strict typing/lint,196 concrete API paths/verbs/references and all71 applied migration checksums passed. The new statement browser journey passed5.4s after correcting saved-textarea labels, including earned/unpaid results, explicit owner presentation/tax mapping without duplicate cost, balanced BS, protected receivables drill-down, private employee denial and mobile/WCAG. Full/focused Word/private-value checks accompany separate F34 publication; fresh CI is observed after push. Actual fiscal-year close/reopening evidence follows in F40; owner acceptance and live activation remain unfilled.


## Cash-flow review example through F35

Synthetic receipt98.00 plus separately recorded fee2.00 settles100.00, but its actual cash leg is98.00. A mixed supplier bill60.00 service plus40.01 equipment is settled with100.01 actual cash; stored reviewed parts show60.00 operating outflow and40.01 investing outflow. An actual200.01 cash capital contribution can be explicitly reviewed as financing; a separate200.01 noncash contribution creates no cash-flow source. A10.01 bank-to-bank transfer nets zero and remains outside external flows. Its review is still required rather than inferred from the zero net. Actual dated reversals inherit the original category and opposite amount; historical cutoffs preserve earlier cash movement. None of these synthetic choices adopts real company policy.

962 distinct local checks passed:282 unit,626 actual PostgreSQL integration (302.84s),54 Chromium (3.3m). Both production builds, strict typing/lint,199 concrete API paths/verbs/references and all72 applied migration checksums passed. The new cash-flow browser journey passed3.8s, including fresh confirmation, exact mixed replacement, retained history, current private API, employee denial, mobile and WCAG. Full/focused Word/private-value checks accompany separate F35 publication; fresh CI is observed after push. Human acceptance and live finance activation remain unfilled.


## Historical ageing review example through F36

An actual synthetic100.01 invoice remains100.01 at its original as-of cutoff, even after a later20.00 receipt has been posted. At the receipt date the historical amount becomes80.01. Releasing the receipt allocation later restores100.01 without returning cash; undoing that release on a later date restores80.01. Source-line credits and their opposite events use their actual dates in the same way. Bills follow the same dated logic, including founder settlement that reduces AP without a company bank payment. Due today stays in the not-due bucket;30/31,60/61 and90/91 boundaries remain exact.

Full company AR/AP totals and control differences stay complete when document search returns no rows. Individual account issues cannot cancel into a misleading grand zero. Historical source history retains earlier-page running balances, with actual private journal links and a clear distinction from the current source page.

985 distinct local checks passed:285 unit,645 actual PostgreSQL integration (329.29s),55 Chromium (3.4m). Both production builds, strict typing/lint,203 concrete API paths/verbs/references and all73 applied migration checksums passed. The new historical-ageing browser journey passed3.2s, including real later payment/earlier cutoff, exact dated source history, current private API, employee denial, mobile and WCAG. Full/focused Word/private-value checks accompany separate F36 publication; fresh CI is observed after push. Human acceptance and live financial activation remain unfilled.


## F37 checkpoint boundary

Checkpoint checks passed:285 unit tests,17 focused PostgreSQL cases (17.29s),two affected browser journeys, production build, strict typing/lint,206 concrete API paths/verbs/references and all75 applied migration checksums. This is an in-progress F37 checkpoint: full backend/browser regression, a dedicated roll-forward browser journey, Supabase-shaped build and final milestone acceptance remain pending. Current implementation is available for source review; this does not complete company/accountant acceptance or enable live finance.
