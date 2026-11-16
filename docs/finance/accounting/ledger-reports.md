# Posted general ledger and trial balance (F33)

Finance remains disabled live. These reports are current-private reads for ACTIVE selected Super Admin only. They create no ledger, financial audit or command receipt. Financial sources remain in the finance domain; ordinary ERP responses do not gain financial fields.

## Dates, actual sources and exact balances

A general ledger chooses one PKR posting account, including protected controls and archived accounts. Opening is actual debit minus credit before the inclusive start date. Period movements use actual GL posting dates; closing is opening plus debits minus credits. Running balance sums every preceding dated line before pagination, ordered by posting date/journal ID/line sequence/line ID. Debit-positive balances display DR, negative balances CR; a debit-normal account may have a real credit balance. Empty ranges still carry opening to closing.

Drafts and voided unposted sources are excluded. Posted originals, opening/YEAR_CLOSE entries and dated opposites are included without double-counting their sources. Typed reversals are new posted source documents; their action can be POST. Report rows identify source kind, reversal status and the actual original source ID/type, alongside source links. Money uses exact strings/SQL numerics; aggregate balances may exceed the individual document maximum without losing paisa.

Dates0001..9999 are supported, including equal endpoints. Opening uses date<start, never subtracting one day from year1. A future report cutoff includes only actual posted records, not projected drafts. Default month-to-date filters do not adopt a January fiscal year or any unconfirmed company policy.

## Complete company trial balance

Each posting account has opening DR/CR, period debits/credits and closing DR/CR. Archived accounts with history remain included. Full company totals and opening/movement/closing differences are calculated before display search, zero-account suppression or pagination. A displayed single account is not falsely labelled a balanced company trial balance; complete company totals stay separate. Accounts with period activity remain visible even when closing nets to zero. Zero-account display includes unused posting accounts explicitly.

## Consistency and access

Current Person/role/grant locks are acquired before a shared finance configuration lock. All financial writers take the exclusive lock. The canonical SQL report reads rows, aggregates and metadata from one statement snapshot. Do not naively replace the access callback with a repeatable-read snapshot that could predate waiting for a grant revocation lock. Concurrent posting yields a complete before/after report, never mixed rows and totals.

Metadata records company, PKR, posted accrual basis, timezone, filters, generation timestamp, posting cutoff/count, database snapshot and a digest of actual included posted entries. Each HTTP page request is a current live report and can receive a new snapshot; retained exports/issued statements follow in F38/F39. Responses and choices are25-row pages with stable ordering. The runtime may call one actor-checked report interface; raw helpers and all Data API execution are denied. Source amounts, provider sessions and configured secrets never enter logs.
