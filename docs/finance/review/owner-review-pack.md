# Finance owner review pack — preparation in progress

Prepared for Talha Ahmad, as requested on 14 November 2026. Intended Finance Owner: zablerkhanahmad@gmail.com. This identifies the intended owner only; no live finance grant or configuration is implied.

## Current evidence and scope

F01–F25 are implemented and merged through PR3, merge b83951d280361b44a57d93b8c8f01e9109096e65. Exact-head CI43584464377 passed before merge. F26 engineering is locally verified on finance/f26-f48; final publication/build evidence is in the continuation tracker. F27–F46 remain pending. This preparation does not mark F47 human review or F48 acceptance/release complete.

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
