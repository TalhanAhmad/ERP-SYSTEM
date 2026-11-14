# Explicit bank matching (F31)

Current ACTIVE selected Super Admin only, private/no-store. Finance remains disabled live. Synthetic local sources only; matching never posts GL or executes cash.

## Reviewed allocations

Choose a retained imported statement record and an actual posted cash GL line for the same original bank/GL mapping, PKR and receipt/payment direction. The cash amount is the actual debit or credit, never an invoice gross amount. New matching requires an active bank and cash mapping. Both individual sources and aggregate proposed amounts on each side are capped to remaining capacity. Distinct pairs, maximum100 per group, support partial, one-to-many and many-to-one matching across groups.

Preview captures immutable source identity and current event digests. Current SQL independently derives all values. Any match/unmatch history invalidates the basis even if the remaining amount returns to its previous value. Explicit confirmation requires current password/hosted TOTP, permanent key and current grant. IDs/numbers are server-generated; no automatic amount/date matching.

## Dates and corrections

Each allocation takes the later of bank value date and GL posting date. Both dates must have arrived in Pakistan time; each effective period must be open and is marked used to retain it. Decision timestamp remains separate. Undoing the complete group retains original allocations and one exact negative event per allocation on its original effective date. It corrects association, not cash flow. Closed original periods must be reopened by the later F39 owner workflow. Issued snapshots are retained/superseded on reopening; no closing bypass is provided here. A replacement association is a new group.

Active allocations block original cash reversal and statement void. Resolve matching first. Actual later refunds/payments follow their normal reviewed typed workflows and remain distinct real cash legs. Reversal cash legs can be explicitly associated with real opposite bank activity; there is no automatic pairing or fabricated movement. Zero-activity reconciliation uses later F32 balance/evidence rather than zero CSV movements.

## Retention and access

Group DRAFTv1 cannot persist; MATCHEDv2 and UNMATCHEDv3 retain frozen business snapshots. Allocation/event rows resist update/delete and forged opposite events. Deferred checks prove event cardinality, source identity and both-side nonnegative capacity; no existing GL scalar fields or source snapshots are changed. Runtime has SELECT only plus three actor-checked interfaces; internal helpers, number sequence and Data API writes remain denied. Choices/detail are25-row pages with stable ordering, source links, explicit dates, amounts and actor/reason history. General ledger reporting, final reconciliation and closing are subsequent milestones.
