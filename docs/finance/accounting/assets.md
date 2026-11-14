# Asset registration through F25

Register equipment against one real posted ASSET bill/paid-expense line or a fixed-asset noncash-capital/founder-outlay source. The posting already recognized the cost. Registration adds an immutable purchase link and no new journal, payment or payable.

Eligible cost is the original asset-account debit less subsequent source credits/corrections in the immutable GL. Bill sources filter the exact original cost account and bill-line FK, excluding recoverable input tax. Funding sources include the original fixed-asset leg and its dated reversal. Under finance/configuration locks, active allocations cannot exceed that remaining net cost. Deferred journal-line/source checks also block later credits or funding reversals that would understate linked registered assets.

Source/account/cost/dates/snapshot stay immutable. An unused registration can be VOIDED with fresh authorization and a reason; history remains and allocation is released. A replacement registration can reuse the inactive tag. Location, custody and planned policy are versioned metadata. Ordinary people/HR APIs gain no financial fields.

The register stores service date, useful-life months, residual, straight-line method, accumulated depreciation and disposal fields. F25 enforces zero posted depreciation/no disposal because these commands belong to F26. The default convention is PENDING with no first month. Explicit full-month confirmation needs company evidence and a first month on or after both service and original source recognition. No company policy or scheduled charge is adopted automatically.

All public writes require current selected-admin access, fresh provider verification, canonical Origin/CSRF, a permanent request key, strict fields and the current source version. Server-only command/retention guards and private audit operate independently of UI visibility. Hosted finance remains disabled.

## F26 lifecycle

Full-month straight-line generation requires the confirmed first month and approval evidence. The ordinary monthly charge is floor((cost minus residual) in paisa / useful-life months); the final month receives all remaining paisa. Zero early charges remain auditable posted register events without fabricated zero-value journals. Earlier plan months must be posted before later months. A permanent unique(assetId,month) source survives voiding; reviewed reopening uses that same identity. Generation does not post.

Asset movements have a frozen basis snapshot and digest of the asset’s financial data and immutable event history. Posting an intervening movement makes other drafts stale; refresh and review are explicit, versioned actions. Current cost and carrying value derive from original recognition plus dated events, rather than the original cost field alone. The original purchase allocation remains consumed for disposed assets too.

Depreciation debits a reviewed ordinary expense and credits the protected accumulated-depreciation control. Impairment debits expense and reduces asset cost. Explicit reviewed cost increases/decreases use the protected asset leg plus an ordinary counterpart, without silently changing recognition history. A value change or correction requires a prospective reviewed remaining-life/residual/first-month policy before more depreciation; such a policy is itself a register event with no GL. Initial financial policy fields freeze after use; metadata such as location remains editable.

Disposal clears the actual current cost and every actual accumulated-depreciation account separately, records gross-proceeds gain/loss against carrying value, separates fee expense and net cash, and marks the asset disposed. Nil proceeds have no cash leg; fees exceeding proceeds produce an outflow. A fully exhausted nil-proceeds asset has only a retained register event when no positive GL lines are required. No real bank transfer is initiated.

Corrections create one dated opposite source/event/journal, retain originals and preserve actual original mappings. Effective-date order, nonnegative historical cost/depreciation/carrying, used policy, earlier-month dependency, exact expected source/event/GL and period/future checks apply. Reversing a consumed increase, overstating impairment or depreciation, or forging cached balances fails atomically. Posted sources and events cannot be edited/deleted. Runtime receives SELECT plus the checked command, never raw writes/helpers/sequences; browser/Data API roles are denied.

The default company convention remains pending. Synthetic test conventions, accounts, dates and approval evidence are not live adoption. Lifecycle supporting references remain on their immutable source; source-bound purchase attachments remain available on the original purchase. No hosted schema, grants, financial policy or scanner configuration is changed by F26 development.
