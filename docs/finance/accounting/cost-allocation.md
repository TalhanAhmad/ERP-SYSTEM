# Reviewed project cost allocation and actual results (F28)

## Eligible original source and reviewed net basis

A cost allocation references an actual immutable posted expense debit journal line, not a bill-line ID or a forecast. Eligible original source types are bills/immediate expenses, manual ordinary journals, funding/treasury movements, asset lifecycle charges/results and customer/supplier document fees. The original account must be an active PKR ordinary noncontra DIRECT_COST, OPERATING_EXPENSE or OTHER_EXPENSE account. Protected controls, generated allocation lines and reversal-only debits cannot start a second source pool. Original supplier bill components remain canonical even when a supplier-credit reversal restores their cost.

The current full net pool includes actual original expense postings and their typed credit/reversal history. Recoverable purchase tax is not expense. A hash captures the original line/source, exact net, latest source date and immutable component count/digest. Drafts retain the reviewed hash and amount. Changes to the underlying source require explicit review, an exact new split and saving the same draft before posting. The source line cannot be replaced during editing.

Allocation posting dates must be on or after the latest source financial activity and prior allocation activity, within an open accounting period and no later than the Pakistan accounting date. This deliberately requires reviewing the current complete pool; it is not a historical partial reconstruction wizard. Company backfill/cutover policy remains for the owner review pack.

## Exact split and balanced posting

One to100 unique project/shared dimensions must total the full reviewed positive net cost. Shared company cost has a null project ID. At least one positive target must differ from the original dimension. Target projects can retain archived history. Explicit amounts use exact PKR strings. The optional read-only percentage preview accepts up to6 fractional percentage digits, requires exactly100%, computes integer paisa shares and distributes remaining paisa by largest fractional remainder, then original split order for ties. Three paisa split50/50 produce0.02 and0.01; no final-row negative rounding is possible. Preview does not post, issue a write receipt or consume fresh write verification.

Posting uses the shared checked journal emitter. It debits each positive target and credits the original project/shared dimension on the same original expense account; every line retains the original party ID. The journal is balanced and changes project attribution only. It does not duplicate the cost, clear a payable, manufacture cash, change company profit or change the source bill. Frozen source/header/targets must exactly reproduce the GL under deferred checks.

## Corrections and dated capacity

A source may have only one current posted allocation. Concurrent posts serialize and permanent request receipts return the same result. Drafts may be edited or voided with current versions. Posted and voided history cannot be overwritten or deleted. A dated reversal copies the frozen targets/source and posts the actual opposite lines; a new reviewed allocation can then be created.

Historical end-of-day cumulative allocations cannot exceed the underlying cost at any date. The guard includes previously reversed allocation intervals. A later-dated reversal does not permit a backdated supplier credit to invalidate an earlier allocated interval. Reverse the allocation at a compatible open date before reducing/reversing the underlying source; a same-day correction and source credit can coexist. This guard applies to underlying bill credits, manual reversals, treasury/source corrections and asset/customer fee corrections too, with an actionable409 response. No allocation-generated line becomes a new pool.

## Private project results

The date-filtered result reads actual immutable GL, using accounting posting dates. Net invoiced includes invoice/credit income and deferred-revenue legs, excluding tax and including dated opposites. Recognized income reads INCOME/OTHER_INCOME. Direct costs read DIRECT_COST; assigned overhead reads OPERATING_EXPENSE/OTHER_EXPENSE tagged to this project. Contribution is recognized income minus direct incurred costs. The result after assigned overhead deducts assigned overhead once. Unpaid supplier costs count when posted, independently of payment.

Company unallocated overhead and unassigned direct costs are separate company figures; they are not deducted again from an individual project. Contract values, variations and billing milestones do not recognize income. Cash collections, mixed receipt attribution, receivable rollforwards and budgets remain separate later-milestone reports; this result does not return fabricated cash metrics. Year-close entries are excluded from operating results.

## Access and deployment boundary

All sources, choices, previews, results and screens require the current ACTIVE explicitly selected Super Admin, independently of project management membership. Responses are private/no-store. Writes require canonical Origin/CSRF, current password/hosted TOTP, opaque provider/session-bound proof, permanent key and current source version. Current access is checked before input parsing in services. Runtime roles receive SELECT and checked actor-gated interfaces only; generic source/capacity/emitter helpers, sequences and direct source writes remain denied. Live finance remains disabled and no hosted migration or real allocation was made.
