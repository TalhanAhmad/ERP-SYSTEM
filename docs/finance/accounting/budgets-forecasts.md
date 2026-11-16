# Approved monthly budgets and separate cash forecasts (F29)

## Plan scope and retained revisions

A budget covers one month, one existing immutable project ID or shared-company dimension, and one to100 unique ordinary expense accounts. DIRECT_COST, OPERATING_EXPENSE and OTHER_EXPENSE accounts must be active PKR noncontra posting accounts at drafting and approval. Exact nonnegative line amounts and total must fit the supported PKR range. A zero plan is a valid advisory baseline. Month/project scope is immutable; corrections to scope require voiding an unused draft and creating the right plan.

One current approved budget and one draft are allowed per month/project scope, including null shared scope. The first draft has no previous approval. A replacement explicitly references the current approved ID/version; its lines remain reviewable. Drafting leaves the previous approval current. Approval atomically supersedes that approval and freezes the new business snapshot and lines. Voiding a replacement leaves the prior approval current, retains its abandoned revision and never reuses a revision number. Previous approved plans, supersession reasons and replacement links remain visible. Approved/superseded/void history cannot be edited or deleted. Future planning months are permitted without opening accounting periods.

Approval checks current account mappings and a real approval evidence reference. Inactive or reclassified mappings later remain visible as historical budget references and are flagged for review before a new approval. Financial posting semantics and immutable GL history remain independent of the plan.

## Same-basis incurred variance

Variance always identifies the current approved revision for the exact month/project/shared scope. It compares its expense-account lines with actual posted GL activity on the same accounting dates and project dimension. Unpaid supplier bills count when incurred. Original costs, actual credits, reversals and exact project reclassification all contribute once. Forecasts, contract amounts, billing plans and cash settlements do not substitute for incurred expense. Year-close journals are excluded from operating actuals.

The account set is the union of planned and actual accounts: unbudgeted costs cannot disappear because there was no budget row. Each row shows exact budget, incurred actual and remaining (budget minus actual), with advisory exceeded/unbudgeted labels. Totals use exact paisa, including negative remaining and large values. Missing approved plans still show actuals against a zero baseline. Archived projects retain access to their private plans and actuals. Shared company scope means the null project dimension; it does not silently combine every project into a second budget.

Warnings never block required expense recognition. Historical budget snapshots remain accessible, while the variance page clearly uses the current approved plan. Final report snapshots and wider company statements remain later milestones.

## Expected cash plans

A forecast is a separate RECEIPT or PAYMENT expectation with its own expected date, positive exact PKR amount, optional project and party, description, evidence reference, likelihood (POSSIBLE/LIKELY/COMMITTED) and a required likelihood note. Future dates are valid. Likelihood is a stated planning judgment, not an automated probability or proof of payment.

Active forecasts can be edited with a current version, cancelled and reopened with retained audit history. Cancellation never reverses real cash, and reopening does not recreate a receipt/payment. A forecast cannot post GL, recognize income/expense, clear a receivable/payable or mark cash as paid/collected. It remains separate from approved expense budgets and from actual cash-component reporting.

## Private command and verification boundary

All screens, sources, options, variance and HTTP responses require the current ACTIVE explicitly selected Super Admin, independently of project management. Responses are private/no-store. Writes require current credentials/hosted authenticator proof, canonical Origin/CSRF, actor/session-bound proof, current version and permanent scoped idempotency. Checked SQL independently validates role/grant/session, source scope, revision relationships, exact amounts, account eligibility and frozen snapshots. Concurrent approvals serialize. Runtime roles have SELECT and the checked planning command, with no direct source writes, internal helper/sequence execution or Data API access.

Additive62 introduces the plans without touching the journal schema or emitter. Additive63 separately tightens forecast text types in the checked SQL interface, preserving applied62. All examples/tests use the dedicated synthetic database. No live budget, forecast, company policy, hosted schema/grant or finance activation is created.
