# Asset registration through F25

Register equipment against one real posted ASSET bill/paid-expense line or a fixed-asset noncash-capital/founder-outlay source. The posting already recognized the cost. Registration adds an immutable purchase link and no new journal, payment or payable.

Eligible cost is the original asset-account debit less subsequent source credits/corrections in the immutable GL. Bill sources filter the exact original cost account and bill-line FK, excluding recoverable input tax. Funding sources include the original fixed-asset leg and its dated reversal. Under finance/configuration locks, active allocations cannot exceed that remaining net cost. Deferred journal-line/source checks also block later credits or funding reversals that would understate linked registered assets.

Source/account/cost/dates/snapshot stay immutable. An unused registration can be VOIDED with fresh authorization and a reason; history remains and allocation is released. A replacement registration can reuse the inactive tag. Location, custody and planned policy are versioned metadata. Ordinary people/HR APIs gain no financial fields.

The register stores service date, useful-life months, residual, straight-line method, accumulated depreciation and disposal fields. F25 enforces zero posted depreciation/no disposal because these commands belong to F26. The default convention is PENDING with no first month. Explicit full-month confirmation needs company evidence and a first month on or after both service and original source recognition. No company policy or scheduled charge is adopted automatically.

All public writes require current selected-admin access, fresh provider verification, canonical Origin/CSRF, a permanent request key, strict fields and the current source version. Server-only command/retention guards and private audit operate independently of UI visibility. Hosted finance remains disabled.
