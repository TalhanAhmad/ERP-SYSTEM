# Direct cash-flow rules

F35 uses actual posted PKR `CASH` control legs, including archived accounts and the designated cash-equivalent subset. Existing account constraints allow `isCashEquivalent` only on posting non-contra CASH controls. Ordinary cash remains included when this flag is false. Investment holdings are separate assets; this milestone does not introduce securities as cash equivalents.

Opening cash sums actual cash debits minus credits before the start DATE; closing cash includes posted activity through the inclusive cutoff. No subtraction of a day is needed at year 1. Noncash journals create no cash-flow sources. Fees and withholding recorded outside the actual bank leg do not become extra cash: an actual98.00 receipt plus2.00 fee contains98.00 cash, regardless of its100.00 settlement amount.

## Reviewed components

A selected finance administrator reviews the actual source purpose and records positive exact operating, investing and financing amounts against each cash leg. Mixed supplier settlements can contain different purposes on one leg. Every actual cash leg must be covered exactly; foreign, noncash, duplicate or excess/missing parts are rejected. The sign comes from the actual ledger debit/credit, never a caller-supplied inflow assertion.

Internal parts must net to zero across the complete source. Pure cash-only journals, including transfers between included cash accounts, must be entirely INTERNAL. They stay outside external inflows/outflows. No component, amount/date match or old source is silently adopted by a migration. The UI supplies exact internal-transfer amounts but still requires explicit confirmation and evidence. Other categories remain an explicit reviewed choice.

Confirmation requires current ACTIVE Super Admin status, an explicit current finance grant, current provider session, fresh password/hosted authenticator verification, Origin/CSRF, permanent idempotency key, current review identity/version and server-derived source/review/reversal basis. Original and all actual linked reversal periods must be OPEN. The source snapshot freezes explicit immutable entry/cash-leg fields rather than mutable account names, archived status or inverse reversal collections.

A confirmed review cannot be edited or deleted. An explicit replacement retains its prior source snapshot, component rows, actor/time/reason and audit; the previous review is superseded atomically. Deferred checks reject a committed draft or incomplete source split. Neither action posts or rewrites a journal.

## Dated opposites and report completeness

Actual generic or typed reversals locate the original entry through its retained source relationship. Components inherit the original reviewed category on the same actual account/sequence with the opposite sign. A reversal cannot be independently reclassified. A later reversal does not invalidate the original immutable business snapshot, but a reversal added since preview invalidates that preview. Correcting the original requires all affected periods to remain open.

Opening plus classified external cash change must equal closing. INTERNAL net must be zero. Any missing original/derived review leaves classificationReady false, even for a net-zero transfer or original/opposite pair. Unclassified cash is a diagnostic, not a balancing account. Future controlled OPENING/YEAR_CLOSE cash sources cannot be disguised as ordinary income; the opening workflow adds its own rules in F41.

Company totals, readiness and review-version digest are calculated before display search and25-source paging. Each response records the actual ledger snapshot/digest and component digest. Review detail is bounded to200 actual cash legs and25 historical reviews/page; confirmation accepts at most800 parts within the ordinary256KiB request limit. Financial source links preserve private access. Final financial exports later combine this classification gate with actual book, presentation, subledger and bank-reconciliation checks; this milestone does not issue an export.

## Verification boundary

Dedicated synthetic PostgreSQL and browser identities exercise actual typed sources, mixed purchases, reversal dates, retained replacements, precise sums, source pages, access and mobile/WCAG. No hosted finance migration, activation, real policy mapping, company statement or bank operation occurs.
