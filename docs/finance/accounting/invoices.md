# F11 invoice backend

Started 12 November; verified 13 November 2026, Asia/Karachi. F11 supplies typed invoice sources, private API and earned/deferred posting services. F12 supplies the editor, preview and private printable document. Live finance remains disabled.

## Source and amounts

A FinanceInvoice owns 1–100 FinanceInvoiceLine records. Headers reference an active CLIENT/BOTH FinanceParty and an explicit receivables account; optional header project becomes the default for lines. Dates are real ISO dates within years 0001–9999. Posting/due dates cannot precede invoiceDate. Posting requires an OPEN period and a date no later than today in Pakistan time. Due date may be later than posting.

A private noncycling PostgreSQL sequence generates INV- plus ten digits; unique numbers are never reused, including voids. Rollback may leave numbering gaps. External reference is optional and deliberately not unique. No caller-supplied number, ID, calculated total, contact snapshot or actor is accepted.

Quantity/rate use positive/nonnegative exact strings with up to 14 integer and 6 fractional digits. Each quantity×rate rounds HALF_UP to PKR cents before subtracting an explicit per-line discount amount. The discount cannot exceed that rounded gross. Summation uses rounded lines, never binary Number money. PostgreSQL independently recomputes every persisted amount with unbounded intermediates, then enforces NUMERIC(20,2) limits. Zero/free lines remain evidence but emit no journal/event; an all-zero invoice can be drafted but cannot post. Taxes are unsupported/zero in F11, with unknown tax inputs rejected; this is not an assertion about company tax status. F18 will add reviewed configurable codes.

## Typed posting

One private encova_finance_emit_journal function now handles manual posting, dated manual reversal and invoice posting. Only current-session/fresh-auth command adapters can invoke it; runtime cannot execute the emitter directly. The existing manual source/balance/reversal guards remain mandatory.

An earned line credits an active noncontra ordinary INCOME/OTHER_INCOME account. A deferred line credits an active noncontra LIABILITY/DEFERRED_REVENUE control and retains its future revenue account. AR is debited for the positive total using an active noncontra ASSET/RECEIVABLES control. Each positive line supplies a separate referenced credit; all journal lines carry party identity, and credits carry invoiceLineId. Generic manual journals cannot hit receivables or deferred controls.

Posting atomically writes the immutable balanced journal, source state/version, frozen allowlisted client contact snapshot, dated INVOICE receivable event, positive per-line BILLED deferred events, current/future account and ancestor usage, party usage, period usage, permanent receipt and restricted exact-string audit snapshot. Deferred billing creates no service revenue or bank movement. No authoritative mutable balance is stored. Dated events support later historical calculations; F11 does not expose an ageing or financial statement API.

The persisted partySnapshot has schemaVersion 1 plus legal/display name, kind, email, phone and address. Posted document views must use it even when the current party master changes. Typed header/line commercial fields are immutable. Audit revision snapshots preserve previous drafts; no password/session/TOTP is included. Drafts can be edited or voided with an exact version. Posted correction/recognition/settlement workflows remain F15/F42/F13; there is no generic invoice reverse endpoint.

## Transaction and privilege boundaries

Commands lock administration (987661), current Person/grant/session, then structural configuration (629815) before source/period/account rows. Master/config/posting writes use the same structural ordering, preventing archive/period races. Permanent INVOICE_CREATE/UPDATE/POST/VOID receipts live in FinanceLedgerReceipt and bind actor/action/key to canonical normalized input. Same-key retries return the first result after current authorization; changed payloads conflict. Competing versions produce one winner.

Deferred constraint triggers check source/line cardinality and exact totals, one matching journal, exact AR and per-line deferred events at commit. Posted source/journal/event rows reject UPDATE/DELETE. Runtime encova_app gets SELECT and the checked command only; private emitter/snapshot/usage helpers and invoice sequence are unavailable. anon/authenticated have neither finance table nor command access, including after setup replay. Operator SQL remains a separate privileged boundary.

Existing ERP Outbox is an email queue. F11 queues no client email or asynchronous file task: all accounting effects and receipts are synchronous. Reusing email payloads for financial events would expose data and trigger unintended mail. A finance-specific job/outbox adapter belongs with actual F38/F42 export/recognition work. No automatic client email occurs.

## Verification and next boundary

See [F11 results](../testing/F11-results.md). F12 must add an accessible editor, account/party selection, preview and authenticated private printable invoice, retain request keys after uncertain responses, and display the frozen posted snapshot. Receipt allocation, credit caps, tax mapping, recognition caps and full end-to-end accounting acceptance are not claimed by this milestone.
