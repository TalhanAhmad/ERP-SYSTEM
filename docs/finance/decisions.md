# Finance decisions

| Decision | State | Evidence / next action |
| --- | --- | --- |
| Existing stack and separate finance domain | Accepted for build | Supplied finance requirements; reuse repository stack |
| PKR only, accrual double entry, one posting engine | Accepted for build | No foreign currency or money transfer execution |
| Work across milestones | Previously explicitly authorized by Talha | Direct user instruction supersedes document's default daily approval rhythm; no fabricated daily effort |
| Intended Finance Owner | Confirmed: zablerkhanahmad@gmail.com | Talha explicitly selected this existing account on 11 November; resolve and validate immutable ACTIVE SUPER_ADMIN Person ID during controlled setup, never use email alone as a grant |
| Actual finance ownership/grants in hosted database | Not configured | No live grant or migration is created by owner identification |
| Finance feature flag | Disabled by default | FINANCE_ENABLED=false; no grants backfilled |
| Owner transfer/recovery/last-owner guards | Implemented and locally verified F04 | Dedicated audited flows, database guards, password plus hosted fresh TOTP; actual live setup remains pending |
| Fiscal year and cutover date | Pending company/accountant | Do not assume January or import opening balances |
| Revenue/deferred recognition and account mappings | Pending company/accountant | Example fixtures are not approved company policy |
| Asset threshold, useful lives/residuals | Pending company/accountant | No automatic depreciation policy |
| Investment classification/measurement per holding | Pending company/accountant | No guessed valuations |
| Tax/withholding codes and rates | Pending company/accountant | No inferred Pakistan tax rates |
| Evidence retention and malware scanner | Pending operator/company | Quarantine unavailable files; never assume clean |
| Live MFA/reauthentication and owner recovery | Implemented F04; hosted human setup pending | Preserve current ERP access while finance remains disabled |
| Staging, accountant representative dataset, live opening balances | Pending | Isolated fixtures only until reviewed |
| Finance deployment/launch | Pending separate authorization and acceptance | No finance migration or enablement on live services in this delivery |

F05 decisions: setup mutations are Finance Owner-only, selected administrators read-only; account codes are retained on archive, group and control mappings checked, no mutable account balances. Periods use inclusive non-overlapping dates; unused voiding corrects setup, while close/reopen is deferred to F39. Exact PKR strings, precision-64 isolated Decimal and line-level HALF_UP rounding are implementation rules, not company chart/tax/fiscal-year approval. No company chart or period is seeded.

F06–F10: selected finance users may make ordinary reasoned/evidenced adjustments; setup remains owner-only. Protected controls are blocked until true subledger workflows exist. Initial posting/configuration uses an exclusive structural lock before rows, trading write parallelism for clear safety; changes require representative-volume/race validation. Reversals append dated opposite lines; source REVERSED is derived, not rewritten. At F08 re-estimated remaining 260–360 engineering hours; working range after F10 240–340, excluding human/provider waiting and without asserted effort spent.
