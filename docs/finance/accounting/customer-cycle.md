# Customer accounting through F15

Implemented 13 November 2026. Every financial mutation requires current selected ACTIVE Super Admin access, fresh password and hosted fresh TOTP, a reason, CSRF/origin, a permanent request key and an exact source version. Ordinary ERP roles and unselected administrators cannot access financial records. The feature remains disabled live.

## Posting map

| Source | Debit | Credit | Dated records |
| --- | --- | --- | --- |
| Receipt | Actual bank/cash plus explicit fees | Invoice AR and any unallocated client advance | AR settlement and source advance pool |
| Advance application | Held client liability | Eligible invoice AR | Pool consumption and AR settlement; no cash |
| Credit note | Original revenue or deferred liability | Open AR first, then held customer credit for a paid portion | Original-line credit, AR, customer pool, and deferred adjustment where applicable |
| Refund | Available customer liability | Actual bank/cash | Pool consumption; no expense or AR entry |
| Settlement release | Original invoice AR | Held client liability | AR restored and a new held-funds pool; cash retained |
| Dated reversal | Original credits | Original debits | Opposite original AR/pool/credit/deferred events at the correction date |

Receipt fees are explicit ordinary expenses; withholding/tax is not inferred or treated as a fee. Configurable tax/withholding remains F18. Amounts are exact PKR decimal strings; no floating-point money, client-provided totals or mutable authoritative balance.

## Source integrity

FinanceCustomerDocument stores typed common headers and source references; FinanceCustomerAllocation and FinanceCustomerCreditLine store validated commercial rows. A credit references one posted invoice and distinct original lines. Its cumulative amount cannot exceed each original discounted net line, including all later effective credits/reversals. Deferred credits reduce the protected liability rather than recognizing income. Generic journals still cannot bypass any protected control.

Credit settlement depends on payment activity between draft and posting. FinanceCustomerCreditSplit is therefore created atomically at posting, with immutable AR and held-credit amounts. It reduces eligible AR first and puts a paid remainder into customer liability. A commit-time check independently proves that split against dated receivables. Draft preparation, source, GL, usage, split, dated events, audit and receipt all roll back together on any failure.

FinanceClientBalanceEvent identifies the original receipt, credit note or settlement-release pool. Applying or refunding that pool consumes its dated balance exactly once. Each typed source emits GL through the existing one private emitter; expected-line/event helpers are private and are also used by database commit checks. Runtime can read and call checked commands, never directly write source/ledger/event tables or execute private helpers/sequences. Setup replay preserves these permissions; Data API anon/authenticated stay denied.

## Dates and corrections

Posting uses a current OPEN period and cannot be future dated in Pakistan time. Sources and eligible invoices/funds must be effective by their required transaction dates. Capacity checks consider the candidate date and every later effective date, preventing backdated over-allocation or over-refund. A backdated credit that would invalidate a reserved future receipt is rejected; the later settlement must be corrected first.

REVERSE creates a separate unique dated correction with opposite GL and subledger effects. The original retains stored POSTED state/version; REVERSED is derived from the link. Earlier balances retain the original until the reversal date. A positive source pool must be unconsumed before its source can reverse; applications/refunds must be reversed first. A reversed release also needs sufficient invoice capacity before its opposite settlement can post.

UNALLOCATE releases **every original invoice allocation once per receipt** into a new source pool, keeping cash in the company account. There is no arbitrary partial release or history deletion. Its dated reversal is supported, but the release identity stays permanently reserved. An active release must reverse before a whole receipt reverses. This makes returning cash and undoing an invoice settlement explicit separate choices.

## Documents and screens

Private registers, draft editors, previews, line/source search and correction forms cover invoices, receipts, advance applications, credit notes, refunds and released settlements. Search choices are bounded and paginated, current access is checked before validation, and posting rechecks all mappings/capacities. Contact/commercial evidence freezes when posted. Credentials clear after submissions and never enter saved retry payloads, receipts, PDFs or audit.

Only posted invoices/credit notes download as authenticated private PDFs. The finance access lock is held through generation; no public URL or automatic client email is created. Credit-note PDFs visibly mark a later reversal while retaining frozen original commercial data. Long documents wrap/paginate with a bundled licensed font, traced into Vercel function output. Previously downloaded bytes cannot be recalled by revoking access.

Document register totals include their selected source states and are not cash balances, ageing or financial statements. Billing/collections acceptance does not complete payables, taxes, attachments, treasury/reporting/closing, the full F43 fixture or accountant/company launch acceptance.
