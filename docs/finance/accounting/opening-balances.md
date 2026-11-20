# Opening import and cutover rules

Only the current Finance Owner stages, posts or voids opening drafts. Other currently selected active Super Admins can inspect retained private records. All mutations require fresh provider verification, origin/CSRF, a permanent request key and explicit reason. No live finance or real opening books are enabled.

## Reviewed file

Upload UTF-8 JSON, maximum180000 bytes, formatVersion1, currency PKR, explicit name/cutoverDate/clearingAccountId/evidence, 2–200 single-sided nonzero trialBalance rows and at most200 typed items. The authenticated format page describes fields and provides a placeholder example. Exact money strings support up to18 integer digits and two decimals; investment units support14 and six. Unknown fields, foreign currency and invented client readiness/actor/hash fields are rejected. Detailed positions require original references, dates, mappings and descriptions; unpaid AR/AP also require original due dates and counterparties. Import amounts are the outstanding cutover balances. Original invoice PDFs are not reissued for synthetic opening documents.

Items support AR, AP, CASH, LOAN_PRINCIPAL, LOAN_INTEREST, INVESTMENT, INVESTMENT_INCOME, ASSET, CAPITAL, DISTRIBUTION, FOUNDER_PAYABLE, CLIENT_ADVANCE, SUPPLIER_ADVANCE and DEFERRED. Cash defaults to DEBIT; CREDIT requires a BANK register and explicitly reviewed CURRENT_LIABILITY overdraft presentation. Asset imports retain gross cost, accumulated depreciation, residual, original service date and explicit remaining-life/first-month evidence. Investment imports retain original acquisition cost/date and units separately from reviewed carrying amount; COST holdings cannot introduce unsupported gains. DEFERRED is an already settled legacy unearned obligation, without new receivable, revenue or cash.

## Preview and approval

Staging saves immutable source bytes/hash and typed rows; no journal is posted. Exact-file replay returns the retained batch; changed input under a reused key conflicts. Preview independently validates active master/account/policy mappings, balanced TB, exact typed-control totals, empty ledger and a cutover matching the first OPEN period start. The owner reviews the current basis hash, exact version and cutover/reconciliation evidence before posting. A stale mapping or ledger blocks posting. Wrong drafts are retained as VOIDED, never overwritten.

The bulk journal posts only ordinary trial-balance accounts against protected OPENING_CLEARING. Every typed item independently posts its matching existing source/subledger against that clearing account; TB control amounts are excluded from the bulk. The transaction independently proves every GL balance matches the imported TB and clearing is zero. There is one posted cutover. Original source, actor, review evidence, journal links and proof digest are immutable. Raw runtime writes and internal helper execution are denied; browser-facing database roles have no access.

## Continuing books

Imported AR/AP accept normal partial settlements and imported held advances. Loan events, investment lots, assets, funding and deferred obligations enter their normal registers. Subsequent loan repayments, investment disposal and prospective remaining-life depreciation preserve the opening proof. Cash flow treats opening cash as starting position, without fictitious period receipts; bank matching excludes opening entries from actual transaction candidates. Reporting metadata discloses the cutover; final exports cannot claim unsupported pre-cutover coverage. New posting or historical source documents before cutover are blocked. No imported foreign figures are relabeled PKR.

## Verification and limitations

23 owned fresh PostgreSQL cases and10 unit cases cover full typed posting, exact replay, unmapped/imbalanced/stale/unauthorized failures, original source retention, zero clearing and normal downstream settlements/disposal/depreciation. An actual Chromium upload/approval/download/mobile/WCAG journey passed9.1s. Full cross-module regression is recorded separately in the continuation report. These synthetic files are test evidence; they do not constitute reviewed company books, policies or launch approval. Large historical imports require a separately reviewed volume plan rather than truncation.
