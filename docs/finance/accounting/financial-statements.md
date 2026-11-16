# Profit and loss / balance sheet (F34)

Finance remains disabled live. Current ACTIVE selected Super Admin only; reports/settings/history are private/no-store. No company chart, fiscal year, tax rate or legal/accountant acceptance is inferred from the synthetic examples.

## Actual accounting results

P&L uses posted GL movement in the inclusive selected range, excluding YEAR_CLOSE transfers and their controlled opposites. Income and other income are credit-positive; direct costs, operating/other expense and explicit income-tax expense are debit-positive. Unpaid earned invoices and incurred supplier bills count; deferred billing remains liability and asset/prepayment purchases remain assets until actual expense recognition. Contra/reversal amounts retain their actual signs. No cash-movement substitute is used.

BS uses every actual posted balance through the cutoff, including opening, YEAR_CLOSE and dated opposites. Contra asset credits reduce assets. Liabilities/equity are credit-positive. Unclosed profit is the negative sum of all unclosed income/expense GL balances, including the effect of any year close. Thus posted retained earnings plus unclosed profit represent the result once. No January fiscal year is adopted or used to label a current-year result. F40 later supplies and tests the dedicated actual year-closing/reopening workflow; F34 verifies unclosed profit once before that dependency exists.

Assets − liabilities − posted equity − unclosed profit must equal0.00. P&L sections and BS totals cover the complete company dataset before account search/pagination. Amounts remain exact strings/SQL numerics, including aggregate totals beyond individual source-document limits. Each page is a current consistent financial snapshot; later issued export/closing records retain their own dataset.

## Explicit presentation and readiness

Owner-supplied account type/report group remain the normal coarse mapping. Independently inspect every used balance and relevant period activity; do not silently filter away unavailable/nonposting/currency/classification records. Full book balance and mapping diagnostics gate final-export eligibility. Diagnostics are25-row pages independent of account detail pagination. Display search cannot hide overall readiness or alter company totals.

An unreviewed negative CASH asset is shown provisionally with an explicit presentation issue. The current Finance Owner may record CURRENT_LIABILITY with evidence/version/key/fresh verification. That moves the actual credit balance into current liabilities for newly generated reports without any GL entry or duplicated amount. Absence/restored UNREVIEWED is not company adoption. A blank/zero-bank case does not invent an overdraft decision.

Income-tax expense presentation is optional and explicit for an ordinary PKR operating/other expense account, including archived history. Active mapping moves the actual recorded expense from its existing expense group to the tax-expense line once; net profit is unchanged. Never infer a tax rate or classify VAT/withholding receivable/payable controls as income-tax expense. Ordinary expenses stay in their current chart group unless explicitly classified. Owner deactivation restores ordinary presentation and retains history.

Presentation policy and account-mapping versions/evidence are retained with audit before/after. Reports include policy and tax-mapping digest alongside company/PKR/basis/date/generation/book snapshot/ledger proof. F38 final financial exports must independently inspect these actual diagnostics/equations; no client boolean can override them. F47 owner review remains unfilled; mathematical tests do not supply human acceptance.

## Access and engineering evidence

New sidecar policy/mapping tables avoid altering existing account/GL source scalar JSON. Current role/grant locks and shared financial configuration lock protect reads; canonical stable SQL provides one consistent statement snapshot. Owner writes serialize and independently check current session/grant/owner/fresh proof/version/key. Runtime has SELECT plus exactly two new checked interfaces. Raw helpers/Data API writes are denied; earlier F30 import grants are preserved. Credential/provider proofs never enter settings/audit/receipts.

Local test cleanup restores prior synthetic presentation through the checked owner command and retains the created setting/mapping/audit history. It does not truncate immutable financial records. Synthetic full-company totals compare actual baseline/deltas rather than assuming prior books are empty. Representative isolated review/close books are a later recovery/acceptance fixture, not a filter hiding earlier history.
