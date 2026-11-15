# Historical receivables and payables ageing

The inclusive as-of date reconstructs actual signed `FinanceReceivableEvent` or `FinancePayableEvent` amounts. Source invoices/bills supply their immutable original amount and due date; current payment/document state is not a historical eligibility filter. Unposted drafts have no such events and are absent. Later payments, advance applications, credits, settlement releases and dated opposites affect only their effective date onward. Founder settlement of a supplier bill reduces AP even when the company does not make a cash payment.

## Buckets and source history

Due today is not overdue. Future due dates and today belong in NOT_DUE. Other buckets use actual DATE difference:1–30,31–60,61–90 and over90 days past due. Year1/9999 cutoffs require no subtract-day operation. Original invoice/cost, tax and earned/deferred source treatments do not change the dated receivable/payable arithmetic.

Document original amount and remaining open amount are separate. The default display contains open documents; explicit include-settled preserves zero balances for review. Search, ageing bucket, settled display and25-row page affect displayed documents, not company totals or proof. History links carry the same as-of date and show actual source journals/effective dates. Running balances include all earlier event pages before selecting25 rows. A link to the current source is explicitly labelled current.

## Actual control agreement

All PKR receivables/payables control accounts, including archived masters and accounts outside display filters, are compared with their actual posted GL balance at cutoff. Receivables use debit minus credit; payables use credit minus debit. Subledger totals sum actual signed document events. Per-account differences cannot cancel into a misleading grand zero: any mismatched account or negative document makes reconciliation.ready false. Diagnostics have their own25-row issue page. Negative values remain visible and are never clamped away.

Exact report aggregates can exceed a single NUMERIC(20,2) source amount and remain decimal strings. Metadata identifies company, PKR, posting cutoff, generation, database/ledger proof and dated subledger event digest. Each checked report runs on a consistent SQL snapshot under current finance authorization. No source, journal, audit or classification is written by a report. This control agreement is one future export gate, rather than a claim that bank/presentation/other subledgers already passed.

## Access and acceptance

Current ACTIVE Super Admin plus an explicit current finance grant is required for pages, reports, dated history and every linked private source. Ordinary employees and unselected administrators remain denied. Internal raw report/event helpers are unavailable to application/Data API roles; only the checked actor interface is granted to the trusted server role. No new finance grants or policy are seeded.

Synthetic acceptance uses actual invoices, bills, receipts/payments, source-line credits, their dated reversals, settlement release/undo and founder noncash settlement. It checks date boundaries, historical running carry, full-company proof under display filters, retained archived sources, maximum-sized documents/aggregate paisa, readonly behavior and current role/grant/flag/SQL ACL. No hosted finance migration or real company accounting adoption occurs.
