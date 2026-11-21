# Reviewed recurring drafts and adjustments

F42 adds owner-reviewed monthly BILL/JOURNAL/DEPRECIATION schedules, immutable source templates and a private durable worker. The feature remains disabled live. No real recurring obligation or company policy has been adopted.

## Schedules and worker recovery

The current Finance Owner explicitly chooses first/optional last month, day1–28, source mappings, description and policy evidence. A bill template records an active supplier, payable/cost accounts, one-unit monthly PKR amount and payment terms0–90 days. The amount must fit the normal bill rate (14 integer digits and two decimals). The worker does not assume tax or pay a supplier. Ordinary journal templates record explicit distinct debit/credit accounts and an exact positive PKR amount, excluding cash/protected controls and annual retained mappings. They support reviewed accrual/prepaid recognition drafts, never guessed rates. Depreciation templates use registered assets and their existing reviewed policy; original asset/month uniqueness prevents a second charge draft, including across schedules.

The authenticated owner can pause/resume or prepare due work with fresh provider verification, origin/CSRF, version, permanent key and reason. Templates remain immutable: change the obligation by pausing and explicitly reviewing a new schedule. Completion retains the original grant epoch. A later regrant or ownership transfer cannot silently authorize an old job.

The scheduled worker prepares at most3 due months per pass, with one retained schedule/month key. Claim and release both serialize/recheck the original requester, exact active grant, current ownership and active schedule. A60-second private lease prevents competing finishers; expired work can resume and stale finishers cannot issue a source. Failed attempts are private and visible. Three automatic attempts bound lease recovery; further recovery requires fresh owner review, up to9 retained attempts overall. Failure details contain allowlisted codes, not private source payloads in ordinary ERP operations logs.

A release atomically creates a normal DRAFT bill/journal or reuses the normal asset/month draft. Existing source constraints execute within its savepoint; failure rolls back partial sources and records a safe failed attempt. The worker never selects POST. Original public source commands retain fresh-session verification and all normal validations; shared preparation cores are ungranted. A separate current verified user reviews/posts the actual source. A prepared source may later be edited, voided or posted through its normal retained workflow; the job records preparation, not ongoing source approval.

## Evidenced deferred recognition

The owner selects a posted DEFERRED invoice line, an effective date, exact positive amount and delivered-service evidence. Drafting creates no journal. Posting independently checks remaining deferred capacity at that and all later effective dates, source mappings and open/cutover dates. One immutable RECOGNITION journal debits the actual deferred control and credits its original real revenue account; a matching negative deferred event preserves the subledger/GL agreement. No cash or receivable is created. Permanent keys prevent duplicate posting.

A later owner-verified reversal records the exact original opposite and positive dated deferred event. Original source, actor, evidence and journal remain unchanged. Earlier historical statements exclude later reversals. Protected opening deferred obligations use this same workflow without reissuing an invoice or receiving cash again.

## Opening credit classification

An imported unpaid AR/AP item preserves an opening-clearing technical source line rather than a new sale/purchase. A credit against that item therefore needs the current owner's explicit review of an ordinary opening-equity offset. It must not silently change current sales/costs or reopen clearing. The immutable review binds the exact document input and source lines; updating a draft needs another review. Posting-derived settlement/tax splits are separately validated by the existing normal credit rules and are not mistaken for owner-reviewed inputs. Normal non-opening credits retain their original revenue/cost treatment. Original reviews and credit/reversal history remain private and retained.

## Verification

40 owned PostgreSQL cases include the prior23 opening cases and17 automation/recognition/credit scenarios. They prove actual normal drafts, no automatic posting, exact asset/month reuse, expired/stale leases, original-grant revocation at release, private safe failures,9-attempt cap, dated recognition capacity/reversal, no AR/cash duplication, both legacy credit offsets, stale review denial, raw-core/runtime ACL and private API feature/role checks.13 strict unit cases validate the input boundaries. A real Chromium journey configures/prepares a recurring bill, independently creates/posts/reverses recognition and verifies private mobile/WCAG/keyboard access and employee denial. Final cross-module evidence belongs in the continuation report; synthetic tests are not company/accountant acceptance.
