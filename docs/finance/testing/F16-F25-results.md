# Finance F16–F25 verification — 14 November 2026

## Final local acceptance
759 distinct tests passed:246 unit (3.14s),469 PostgreSQL integration (186.90s),44 Chromium (2.5m). Existing ERP journeys remain in the browser/backend suites; no mocks replace actual PostgreSQL source/ledger/permission/concurrency checks. Typing/lint, local and Supabase-shaped builds,116 concrete API paths/verbs/references, Word XML/relationships/private-value scan and all55 applied migration checksums passed. Tests and financial fixtures use encova_test exclusively; no reset or deletion of immutable financial history occurred.

## Separate publication evidence
| Milestone | Source | Successful fresh CI | Distinct checks |
| --- | --- | --- | --- |
| F16 bills/expenses | 68afc4b |43445524244|609|
| F17 supplier cycle |1ac3ba7|43447137270|626|
| F18 reviewed tax/WHT |b96f38d8; assertion correction42f9ebb|43455396870|642|
| F19 private evidence |32d8614|43459582746|660|
| F20 cash/transfers |e865b55|43463973411|676|
| F21 founder funding |0cbf7dd|43571539369|690|
| F22 loans |c49d84c|43573115093|706|
| F23 investment acquisitions |840dc53|43574210433|721|
| F24 disposal/income/value changes |caa5d2b|43576472332|741|
| F25 purchase-linked assets |Publication after local checks|Fresh CI pending observation|759 local|

F18's older preview assertion was corrected and rerun without weakening its exact amount expectation. F21 SQL alias validation and F24 first-income/stranded-basis guards used new additive migrations, preserving previously applied SQL. Browser checks found the contributor picker and a server/client archive-form boundary; both were corrected and actual journeys rerun. A prematurely overlapping fixture run was refused by ownership guards and then serialized. One F25 owner-initialization timeout occurred before feature testing; the same journey and later full browser suite passed on retry. These failed attempts are not counted as successful acceptance.

## Financial/security proof
- Exact source-to-balanced-GL-to-dated events, strict controls, immutable posted/correction history, version/receipt replay and current grants/provider sessions.
- Invoice/purchase taxes preserve actual reviewed policy/net/tax; withholding participates in evidenced settlement; old permanent source receipts retain their identity.
- Cash register derives complete balances before list filters; internal transfers do not inflate external movement totals.
- Capital, distributions, founder costs, received/advanced loans, principal/interest, investment cost/carrying/results/fees/value changes and asset purchase allocations remain distinct.
- Explicit lot basis, stale-lot detection, final paisa and over-disposal/correction limits; zero-carrying retirement keeps audited register facts without inventing a journal.
- Asset creation/VOID have no financial posting; recoverable tax is excluded; source credits/reversals cannot understate linked registered asset basis.
- Private source-bound evidence quarantines unavailable scans, verifies signed challenge-bound decisions and rechecks current access during bounded downloads; runtime cannot obtain signing secrets.
- Lower roles and unselected roots remain denied, including private artifacts/options; ordinary people/project DTOs gain no financial fields.

## Scope boundary
Engineering acceptance through F25 is distinct from hosted release, company/accountant policy adoption, real financial data, original learner sign-off and F26–F48. No hosted finance migration/grant/enablement or trade/payment is performed. Draft PR3 contains this new source scope and has not been merged by this delivery.
