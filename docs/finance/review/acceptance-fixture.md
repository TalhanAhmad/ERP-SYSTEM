# F43 observed accounting acceptance fixture

This is a deterministic synthetic dataset, not Encova company books or an accountant's approval. The isolated test DB was discarded after verification; retained IDs describe that run and are not live records. Values are PKR, with zero opening balances, no tax, overhead allocation or depreciation, and immediately earned original services. All nine transactions use the checked application services. Cash classifications are explicitly reviewed through the normal owner path, not inferred automatically.

Captured UTC: 2026-11-20T15:55:17.291Z. [Observed JSON](acceptance-fixture.json) includes exact report values, source/code hashes, ledger digest and all nine original entry/source references. The fixture can be reproduced by the guarded acceptance test; it refuses nonlocal targets and existing financial journals rather than deleting history.

| Metric | Expected PKR | Observed PKR |
| --- | --- | --- |
| Journal debit turnover | 1445000.00 | 1445000.00 |
| Journal credit turnover | 1445000.00 | 1445000.00 |
| Recognized revenue | 300000.00 | 300000.00 |
| Direct costs | 120000.00 | 120000.00 |
| Profit | 180000.00 | 180000.00 |
| Total assets | 785000.00 | 785000.00 |
| Liabilities | 105000.00 | 105000.00 |
| Posted capital/equity | 500000.00 | 500000.00 |
| Unclosed profit | 180000.00 | 180000.00 |
| Total equity | 680000.00 | 680000.00 |
| Balance-sheet difference | 0.00 | 0.00 |
| Bank/company cash | 575000.00 | 575000.00 |
| Project contribution | 180000.00 | 180000.00 |
| Recorded project cash | 110000.00 | 110000.00 |
| OPERATING cash flow | 110000.00 | 110000.00 |
| INVESTING cash flow | -110000.00 | -110000.00 |
| FINANCING cash flow | 575000.00 | 575000.00 |

The trial balance closes at905000.00 on each side because it still includes revenue and cost balances; its period debit/credit turnover is1445000.00 per side. These are different measures from785000.00 assets. Equity includes posted capital500000.00 plus unclosed profit180000.00 once. Actual unpaid balances are AR100000.00 and AP30000.00; loan principal is75000.00. Equipment60000.00 and investments50000.00 remain assets rather than immediate expenses.

## Independent follow-up checks

Receiving a50000.00 client advance increases cash/liability without changing180000.00 profit or100000.00 original AR. A20000.00 Bank-to-Petty transfer leaves total cash625000.00 and profit unchanged (Bank605000.00/Petty20000.00). A30000.00 original service credit reduces revenue to270000.00, profit150000.00 and original AR70000.00; cash remains625000.00. Its balance sheet reconciles805000.00 assets to155000.00 liabilities plus650000.00 equity. Repeating the original create/post keys adds no second posting. Earlier base statements/digest remain unchanged.

Fractional quantities0.1×0.2,0.3×0.3 and0.01×0.5 post exact line amounts0.02,0.09,0.01 and total0.12. Three33.335 lines round independently to33.34 each and100.02 total. Two competing60.01 credits against the same100.02 invoice serialize: one posts, one remains rejected/unposted, leaving40.01 and balanced books. These are acceptance inputs, not company pricing or tax policy.

## Actual verification

15 new acceptance cases and15 existing cost-allocation cases passed30/30 in21.25s.351 unit tests passed5.47s; affected budget/project-cost browser journeys passed5.4s/4.4s (two passed11.4s). Both production build configurations, strict typing/lint,250 API contracts and82 unchanged applied migration hashes are checked before publication. Full cross-module F44/F45 verification follows separately. No hosted finance migration, real fiscal policy/grant, actual opening books or human approval was configured.
