# Finance owner review pack — preparation in progress

Prepared for Talha Ahmad, as requested on 14 November 2026. Intended Finance Owner: zablerkhanahmad@gmail.com. This identifies the intended owner only; no live finance grant or configuration is implied.

## Current evidence and scope

F01–F25 are implemented and merged through PR3, merge b83951d280361b44a57d93b8c8f01e9109096e65. Exact-head CI43584464377 passed before merge. F26 source4b0e4a6 passed fresh CI43599585247. F27 source9e23dfc passed CI43604433797. F28 reviewed cost/project result engineering is locally verified with818 checks; publication is recorded in the continuation tracker. F29 is now locally accepted with838 checks; F30 is now locally accepted with865 checks; F31 is locally accepted with882 checks; F32 is locally accepted with902 checks; F33 is locally accepted with921 checks; F34 is locally accepted with940 checks; F35 is locally accepted with962 checks; F36 is locally accepted with985 checks; F37 is locally accepted with1,006 tests; F38 is locally accepted with1,045 tests; F39 is locally accepted with1,080 tests; F40 fiscal-year close/reversal is locally accepted with1,113 tests; F41 opening imports passed fresh CI44736998016; F42 reviewed automation/recognition is locally accepted with1,178 tests. F43–F46 remain pending. This preparation does not mark F47 human review or F48 acceptance/release complete.

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
| Cutover import/reconciliation/closing | Engineering through reviewed opening imports is tested; actual company source file/cutover/control review remains required | Pending |

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


## F37 engineering review evidence

1,006 distinct local tests passed:288 unit,662 actual PostgreSQL integration (364.04s),56 Chromium (3.5m). Production and Supabase-shaped builds, strict typing/lint,206 concrete API contracts and all75 applied migration checksums passed. The dedicated roll-forward browser journey passed4.1s, covering real dated project credits/opposites, actual source workflows, six-decimal investment units, all six report views, mobile/WCAG and employee denial. A real synthetic invoice earns100.01 and defers40.00; a later30.00 earned-service credit leaves70.01 earned income and110.01 net earned/deferred billing at that cutoff. Its later opposite restores earlier values from its own date. Exact source journals link to actual credit workflows, and3.000001 holding units remain a separate nonmonetary measure. These are synthetic examples; owner/accountant acceptance and live activation remain unfilled.


## Engineering publication through PR4

[PR #4](https://github.com/TalhanAhmad/ERP-SYSTEM/pull/4) merged into main on 16 November 2026 at 19:50:22 Asia/Karachi. Merge commit **28065e33ba421d8831ce08bc0aef6ec7dfcc30e4** retains the separate milestone history. Exact final source **3cb6f13b880252540a0522abb8ad9111ee8bf2a8** passed [fresh CI43877779887](https://github.com/TalhanAhmad/ERP-SYSTEM/actions/runs/43877779887) before merge: all75 fresh migrations,1,006 tests, typing/lint,both builds and206-path API checks. Local main was fast-forwarded and its application/schema/test/script/config content matches the verified source exactly. No hosted financial migration, finance enablement or company/accountant acceptance was performed. F47 human/accountant review and F48 live activation remain unfilled.


## F38 representative export evidence

Actual synthetic earned income100.01 and incurred expense60.00 produce balanced160.01 trial movements and profit40.01 with independently agreeing AR/AP controls. A registered no-activity bank blocks a final copy until its actual exact-cutoff review is finalized; a different cutoff is still blocked. Missing asset registration blocks a new final copy. Review exports preserve incomplete diagnostics. Issued CSV/PDF retain the same snapshot and file hashes after later postings. Browser-tested exports include all27 filtered rows, exact values, private current-access downloads and employee denial. These are synthetic engineering checks; they do not approve a company statement, choose accounting policies or complete the human acceptance record above. Logical24-hour availability and private immutable retention are documented for owner review.


## F38 source publication and fresh verification

F38 source **8bca4c26a0cab30f00e9f58a9f3ab407022b9572** is committed and pushed to **finance/f38-exports** on 17 November2026. [Draft PR #5](https://github.com/TalhanAhmad/ERP-SYSTEM/pull/5) contains the milestone and targets main. [Fresh CI44102819006](https://github.com/TalhanAhmad/ERP-SYSTEM/actions/runs/44102819006) passed for that exact source: all77 fresh migrations,1,045 tests, typing/lint,both builds and211-path API verification. The subsequent documentation-only recording preserves the verified application/schema/tests/scripts/config source exactly. The PR remains unmerged; finance remains disabled live. F39 monthly close/reopen is next.


## PR5 merge confirmed — 19 November2026

[PR #5](https://github.com/TalhanAhmad/ERP-SYSTEM/pull/5) merged into main on 19 November 2026 at 13:59:08 Asia/Karachi. Merge commit **30cc426c6a7b03c59bd6786db0498c3152df5783** retains the separate F38 source/documentation commits. Latest PR head **d3f508c96579ffa1322313cc9c47f09aa29aed4b** passed [CI44112657600](https://github.com/TalhanAhmad/ERP-SYSTEM/actions/runs/44112657600) before merge: all77 fresh migrations,1,045 tests, typing/lint,both builds and211-path API verification. GitHub independently confirmed merged=true and the expected source/merge identity. Local main was fast-forwarded and application/schema/tests/scripts/config source matches that tested head exactly. The subsequent documentation-only recording updates full/focused Word reports and preserves that application source. No hosted financial migration, finance enablement or company/accountant acceptance occurred. F39 monthly close/reopen is next.


## F39 owner review evidence

Actual synthetic income100.01 and incurred expense60.00 close with balanced160.01 movements and40.01 profit. Reviewed reopening allows a later3.01 dated correction, while the original close/report values remain unchanged. Re-close creates another numbered cycle. Source/post races cannot admit unreviewed posting. A closed bank proof cannot reopen beneath an issued period close. Current owner review of failed posting outcomes and required adjustments is explicit, with retained evidence and recorded issue resolution; automatic monitoring of historical rolled-back commands is not claimed. The user should review this manual process and future F42 monitoring before adopting real books. All human acceptance and live release fields remain pending.


## F39 source publication and fresh verification

F39 source **35356d61e31036289a6dd35a4466c8dcd8fadef3** is committed and pushed to **finance/f39-period-close** on 19 November2026. [Draft PR #6](https://github.com/TalhanAhmad/ERP-SYSTEM/pull/6) targets main and remains unmerged. [Fresh CI44502508756](https://github.com/TalhanAhmad/ERP-SYSTEM/actions/runs/44502508756) passed for that exact source: all79 fresh migrations,1,080 tests, typing/lint,both builds and220-path API verification. The subsequent documentation-only recording preserves application/schema/tests/scripts/config source exactly. F40 fiscal-year closing is next; F40–F46 engineering, F47 human review and F48 live activation remain. No hosted financial migration, real books/policy adoption or human acceptance occurred.


## F40 fiscal-year review preparation

[Annual rules](../accounting/year-closing.md) describe explicit calendar/retained mapping, exact transfer and original/opposite journal evidence, before/after statements, final-period locks, empty and gross-zero years and immutable reclose history. Review actual fiscal dates and mapping evidence, source failures/adjustments and all automatic controls before any real annual close. Verify P&L is unchanged by the transfer and balance-sheet retained equity plus unclosed profit counts income once. Engineering evidence is synthetic and does not fill human acceptance fields. No live fiscal calendar, mapping or books were configured.


## F40 complete local acceptance — 19 November2026

F40 adds explicit owner-reviewed fiscal calendars/retained mapping, unused void/replacement, full-period coverage and prior-income carryover checks, atomic exact YEAR_CLOSE transfer with before/after annual TB/P&L/BS and final-period F39 close, controlled exact reversal/export supersession and immutable numbered re-closing. P&L stays unchanged by closing entries and balance-sheet retained equity/unclosed profit counts income once. Actual profit40.01 becomes retained equity40.01/unclosed0.00; a real100.02 adjustment after reopening produces loss60.01. Empty and gross-zero years are independently verified. Concurrent retries create one cycle/receipt, and raw runtime writes/unchecked internal function calls remain denied. [Annual rules](../accounting/year-closing.md) and [F40](../planning/days/F40.md) describe scope. F41 opening imports/clearing proof is next; F41–F46 engineering, F47 user review and F48 release remain. Hosted finance stays disabled; no real fiscal policy, mapping, books or grant was configured.

1,113 distinct local tests passed:328 unit (4.96s),726 actual PostgreSQL integration (421.08s),59 Chromium (4.0m). Production and Supabase-shaped builds, strict typing/lint,228 concrete finance API contracts and all80 applied migration checksums passed. The dedicated owned-database annual browser journey passed12.3s before full regression, covering explicit fiscal-year creation, actual income100.01/cost60.00, closing/reversal, preserved original annual statements, real journal link, mobile layout/WCAG and employee denial. All20 focused database cases also passed24.85s after adding actual direct retained-account posting denial and confirming no partial journal survived the rejected post.

Source publication and fresh GitHub verification follow separately. Earlier applied migrations remain unchanged. The full backend run completed before browser preparation; hosted-shaped build followed the entire browser regression. All first final browser cases passed, including the new annual journey. No fake dates, effort hours, owner acceptance or live release are asserted.


## F40 publication and fresh verification — 20 November 2026

F40 source **5ab1e8a5b3ccf6466c28160bca1db91a4a19bd72** is committed and pushed to **finance/f40-year-close**. [Draft PR #7](https://github.com/TalhanAhmad/ERP-SYSTEM/pull/7) targets main and remains unmerged. [Fresh CI44593966836](https://github.com/TalhanAhmad/ERP-SYSTEM/actions/runs/44593966836) passed for that exact source: all80 fresh migrations,1,113 tests, typing/lint,both builds and228-path API verification. The subsequent documentation-only recording preserves application/schema/tests/scripts/config source exactly. The annual browser journey passed12.3s focused and12.1s in full local regression. F41 opening imports and clearing proof is next; F41–F46 engineering, F47 human review and F48 live release remain. Hosted finance stays disabled; no actual fiscal policy/mapping/books, hosted grant or human acceptance occurred.


## F41 reviewed cutover example

A synthetic trial balance has equal debits/credits554.00. Sixteen typed positions enter normal registers once: unpaid AR100/AP60, bank200, loan principal/interest, investment carrying80 versus cost70 with2.500000 units, income receivable3, asset cost100/accumulated20, capital50/distribution10/founder15, customer advance25/supplier advance12 and settled deferred obligation16. Ordinary retained equity323 reconciles the books. Opening clearing is exactly0.00; current income/expenses are zero. Opening cash flow is opening200/closing200 with no fabricated period receipt. Follow-on ordinary collections, supplier payments, advance applications, loan repayment, half-lot disposal and first remaining-life depreciation are tested. The original UTF-8 file/hash/approval remains unchanged. These figures are acceptance data only; the owner must supply and review actual cutover books before any real import.


## F42 reviewed automation example

Two due monthly supplier obligations10.01 each create normal draft bills, not payments or posted costs. An explicit monthly prepaid recognition2.01 creates a balanced draft journal. A reviewed asset/month charge is unique even across two schedules. Expired worker leases resume with retained attempts; an old finisher cannot create another source. A revoked original grant is denied at release. Manual recovery is fresh-owner-reviewed and capped at9 total attempts.

From the synthetic imported deferred obligation16.00, an evidenced delivered portion5.01 moves deferred liability to earned revenue, with no new AR/cash. A future10.99 recognition reserves the remaining capacity; an earlier competing0.01 is rejected. A later exact5.01 reversal restores that deferred portion without changing earlier reports. Imported unpaid customer/supplier credits3.01/2.01 offset explicitly reviewed opening equity, leaving original clearing0.00 and current sales/costs unchanged. Source changes require another retained owner review. These are test examples only; real obligations, delivery evidence and accounting policy remain owner decisions.
