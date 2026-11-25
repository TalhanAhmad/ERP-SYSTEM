# F47 review workbook for Talha Ahmad

Prepared at the user's request for their review, rather than claiming accountant acceptance. Intended Finance Owner: zablerkhanahmad@gmail.com. Actual company figures, policy choices, reviewer/date/signature and live grants remain pending.

## Review the local demo

The isolated demo is available at http://localhost:49278/login on this Mac. Sign in as finance.owner@example.test using the private initial credential in `.local/finance-demo/logins.json`. This walkthrough uses January 2020 synthetic records and does not approve company policies.

1. Open [January profit and loss](http://localhost:49278/finance/reports/profit-loss?from=2020-01-01&to=2020-01-31). Compare earned revenue 300000.00, contractor cost 120000.00 and profit 180000.00 with the original invoice and bill from their source registers.
2. Open [the balance sheet](http://localhost:49278/finance/reports/balance-sheet?asOf=2020-01-31). Check assets 785000.00 equal liabilities 105000.00 plus equity 680000.00. Bank 575000.00 differs from earned profit because receipt/payment timing and asset/financing movements are separate.
3. Open [the trial balance](http://localhost:49278/finance/reports/trial-balance?from=2020-01-01&to=2020-01-31). Compare debit and credit turnover of 1445000.00 each. Use the existing source/journal links to inspect the nine posted sample sources.
4. Open [report exports](http://localhost:49278/finance/exports) to inspect an existing REVIEW copy and its private CSV/PDF. FINAL issuance remains blocked while readiness is incomplete. Viewing/downloading an existing copy does not post a transaction.
5. Sign out and compare the selected administrator with the unselected administrator, HR, Team Lead and Member accounts from the private login file. Selected admin can read finance; the four unselected/lower-role accounts have no finance navigation or authorized finance page/artifact access.

Record any desired interface/workflow changes with the page, role, steps and expected result. Fill the review record below only after your own review. The example chart, fiscal dates and tax-free sample transactions do not establish real company choices. Email/external file storage remain unconnected; hosted finance setup stays deferred at the owner's request. See [the complete local guide](isolated-demo.md) for start/stop, persistence and safe verification boundaries.

## Read these representative statements

[Observed acceptance statements](acceptance-fixture.md) and [machine-readable evidence](acceptance-fixture.json) come from nine actual posted synthetic sources with zero opening, PKR currency, no tax, no January depreciation and explicit cash classifications. They are examples to review, not company books.

| Check | Exact expected and observed amount (PKR) | Meaning to review |
| --- | --- | --- |
| Original capital / received loan | 500000.00 / 100000.00 | Financing receipts are distinct from revenue |
| Earned invoice / receipt | 300000.00 / 200000.00 | Revenue differs from cash; AR remains100000.00 |
| Contractor bill / payment | 120000.00 / 90000.00 | Incurred cost differs from cash; AP remains30000.00 |
| Paid equipment / investment purchase | 60000.00 / 50000.00 | Both remain assets, rather than current expense |
| Loan principal repayment | 25000.00 | Loan liability remains75000.00; no principal expense |
| Bank / earned profit | 575000.00 / 180000.00 | Bank balance is not profit |
| Assets | 785000.00 | Bank575000 + AR100000 + equipment60000 + investment50000 |
| Liabilities / equity | 105000.00 / 680000.00 | AP30000 + loan75000; capital500000 + profit180000 |
| Balance-sheet difference | 0.00 | Assets equal liabilities plus equity |
| Journal debit / credit turnover | 1445000.00 / 1445000.00 | Every actual source balances |
| Operating / investing / financing cash | 110000.00 / -110000.00 / 575000.00 | Explicit categories reconcile to ending cash575000 |
| Project contribution / recorded project cash | 180000.00 / 110000.00 | Incurred margin and recorded cash answer different questions |

Independent follow-ups are separately tested:50000 client advance increases cash/liability without income;20000 internal transfer changes cash location without company cash/profit;30000 original-service credit reduces original AR/revenue without cash. Later live balances do not rewrite the original dated report digest. Exact fractional rates round per line; competing credits cannot exceed the original amount.

## Follow retained sources and exceptions

Use private journal drill-down to the actual invoice, bill, receipt, payment, movement, opening batch or recognition source. Opening imports require original UTF-8 bytes/hash, owner preview/approval, normal typed registers and zero clearing; control balances are not posted twice. [Opening rules](../accounting/opening-balances.md) explain earlier-date restrictions and remaining-life assets. Imported credit classification requires a separate owner input review, rather than treating old equity as current sales/costs.

[Automation rules](../accounting/automation.md) cover monthly drafts, original grant epochs, leased attempts and explicit retry budgets. A prepared schedule does not post a journal. Deferred income needs delivered-service evidence and a separately reviewed recognition; dated opposites retain history. Owner revocation cancels old authority, including after regrant.

[Closing rules](../accounting/period-closing.md) and [year closing](../accounting/year-closing.md) retain frozen reports, dated corrections and retained earnings without duplicate profit. The combined browser journey verifies real statement reconciliation, blocked closed posting, owner reopening, superseded old export and a new corrected private export. Revocation denies subsequent downloads, including an already ready export; downloaded copies cannot be recalled.

[Recovery evidence](recovery-evidence.json) and [runbook](../operations/backup-restore.md) cover populated sources, opening/recognition/recurring history, CSV/PDF artifacts, separate signed evidence object bytes and source/catalog/ACL comparisons. They do not assert hosted PITR/object retention or an actual company disaster-recovery drill.

## Decisions and gaps to record

| Decision | Evidence/reference | User response |
| --- | --- | --- |
| Actual chart, reporting groups, PKR scope | [Posting rules](../accounting/posting-rules.md) | Pending |
| Fiscal year, effective periods, cutover date/source/control reconciliation | [Opening rules](../accounting/opening-balances.md) | Pending |
| Taxes, withholding and effective-date mappings | [Tax rules](../accounting/taxes.md) | Pending; no rates guessed |
| Bank credit/overdraft and tax-expense presentation | [Statements](../accounting/financial-statements.md) | Pending |
| Depreciation convention, first month, remaining life and impairment | [Asset rules](../accounting/assets.md) | Pending |
| Investment measurement, units/cost/valuation and income mappings | [Investment rules](../accounting/investments.md) | Pending |
| Founder capital/payables/distributions and loan directions | [Posting rules](../accounting/posting-rules.md) | Pending |
| Selected admins, owner security/MFA and access review | [Ownership](../operations/ownership.md) | Pending; intended email is not a live grant |
| Actual private bucket, scanner authority and retained evidence policy | [Evidence rules](../accounting/evidence.md) | Pending |
| Hosted backups/PITR, off-site objects, retention, recovery targets/operator | [Recovery runbook](../operations/backup-restore.md) | Pending |
| Recurring schedule terms and recognition approval evidence | [Automation rules](../accounting/automation.md) | Pending; synthetic schedules are not company adoption |

Review each representative statement, explain any mismatch in accounting meaning and record the desired correction before real books. Engineering checks cannot fill these company decisions. No legal/tax compliance or external accountant approval is claimed.

## Review record

Reviewer: Pending. Role/company: Pending. Date: Pending. Reports/source hashes reviewed: Pending. Accepted policies and effective dates: Pending. Required changes/exception owners/due dates: Pending. Decision: Pending. This document is a prepared review pack; F47 human review remains open until these fields are supplied and any accepted corrections are verified.
