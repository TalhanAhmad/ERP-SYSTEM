# Account/period setup and exact PKR

Implemented F05, 12 November 2026. Configuration is separate from monetary posting. Only the current owner changes the chart/periods with fresh password plus hosted fresh TOTP and a reason. Selected administrators have read-only access. No fiscal year, opening balance or company chart is assumed.

## Amount contract

PKR amounts are nonnegative decimal **strings**: zero or 1–18 integer digits without leading zeros, optional 1–2 fractional digits. parsePkr normalizes to two decimals. Maximum: 999999999999999999.99 (NUMERIC(20,2)). Numeric JSON, signs/negative zero, whitespace, exponent notation, NaN, infinity, leading zeros and extra decimals are rejected before database coercion. Positive/one-sided posting rules will be added in the posting engine; zero is allowed by the base amount primitive.

Quantity and unit-rate strings allow at most 14 integer and 6 fractional digits; quantity must exceed zero and rate may be zero. calculatePkrLine multiplies exact inputs with a private Decimal constructor at 64 significant digits, then rounds HALF_UP to two decimals and checks the supported range. sumPkrLines accepts at most 10,000 already-rounded PKR strings and sums exactly before checking range. Ten lines of 1 × 0.005 become ten 0.01 lines, total 0.10. Prisma's global Decimal precision remains unchanged. No floating-point Number money arithmetic or implicit database rounding is used. No tax/discount allocation policy is invented here.

## Chart constraints

ASSET and expense types are debit-normal, LIABILITY/EQUITY/income credit-normal; explicit contra flips normal side. Report groups are restricted by type. Group accounts cannot be posting controls, contra or cash equivalent. Control kinds are asset or liability as appropriate; only accumulated-depreciation controls are contra. Cash-equivalent requires a noncontra posting CASH control. Control registers must be updated with the ledger by future posting workflows; the chart alone cannot bypass them.

Parents must be compatible group accounts; active children require active parents, and cycles are denied. Used classifications, codes, currency, parent and flags freeze, including ancestors with a used descendant. Labels and archive state can change under the owner workflow; active children must be archived before parents. Codes remain reserved forever; no account deletion.

## Period constraints

Both real DATE boundaries are inclusive, end on/after start, year 0001–9999. A PostgreSQL GiST exclusion constraint blocks overlap between any non-VOID ranges, including concurrent/direct SQL. Adjacent ranges may start the day after the previous end. Only unused OPEN ranges may change dates or be voided; void releases dates and retains evidence. Used OPEN labels can be corrected. No setup action closes or reopens a period. F39 will supply reviewed closing/reopening and associated audit/locking.

## Review boundary

Mappings and policies require company/accountant acceptance before real books. F05 tests mark first use directly as synthetic operator fixtures; no journal has been posted. Future F06 must acquire deterministic posting row locks, set usage and write balanced immutable lines atomically, including locks for ancestors, and prove config/posting races. See [posting rules](posting-rules.md).
