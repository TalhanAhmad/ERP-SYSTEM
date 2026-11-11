# Supplied finance specification

Source: Encova_Finance_Codex_Build_Specification.docx, supplied by Talha on 11 November 2026. Converted text retained for traceability. This is a requirements reference, not evidence of implementation or authorization to deploy. Direct user instructions control scope and pace.

Encova Finance Build Specification
Prepared for Talha Ahmad Awan and Codex • 11 November 2026 • Version 1.0
1 Purpose and approved scope
Extend the existing Encova ERP with a complete PKR finance module. Build real frontend screens, backend services, database migrations, financial reports, and verification. The primary interface is Template B: searchable spreadsheet-style registers with a transaction detail drawer. Finance is available only to explicitly selected, active super admins.
This is an implementation specification, not evidence that finance already exists. Talha estimates the ERP is approximately 20 percent complete; that estimate has not been verified against a repository. Preserve existing working features and progress records. Inspect the repository before choosing file locations or implementation order.
Decision
Approved requirement
Currency
PKR only for accounts, documents, ledger, and reports
Finance access
Selected super admins; super-admin status alone is insufficient
Interface
Template B with editable drafts and protected posted records
Funding
Founder capital, loans, repayments, and distributions
Company investments
Holdings, acquisitions, disposals, returns, and reviewed adjustments
Accounting
Double-entry accrual accounting, profit and loss, balance sheet, cash flow, and supporting reports
Integration
Extend existing people, projects, authentication, UI, and audit foundations

Product boundary
Include invoices, bills, collections, payments, client advances, supplier advances, credits, refunds, transfers, assets, depreciation, investment records, budgets, bank reconciliation, period controls, and secure attachments. Records describe money movements; the app does not execute bank transfers or trade investments.
Do not silently add foreign currencies, automated tax filing, payroll calculation, bank synchronization, brokerage integrations, consolidation, or inventory accounting. Full accounting here means a complete general-ledger-based system for the specified service-company workflows. It does not mean automatic compliance with every accounting standard or Pakistan tax obligation.
Accounting policies, tax configuration, opening balances, reporting year, and investment classifications need company/accountant validation before real books are used. Codex can build and test with explicitly labeled demonstration settings while those decisions remain pending.
Navigation through this document
Sections 2–5 define integration, access, and screens; 6–13 define posting and business workflows; 14–18 define reports, data, APIs, and architecture; 19–21 define security and acceptance; 22–24 define milestones and the Codex handoff.

---

2 Integration and implementation decisions
Inspect before changing
Start on the existing repository and read its instructions, dependency versions, schema, migrations, authorization logic, tests, and current progress. Record implemented features with evidence. Do not treat the old specification or this document as proof that a feature works. Do not reset the main ERP milestone plan.
The original Encova specification used Next.js App Router, TypeScript, PostgreSQL, Prisma, Better Auth, Zod, Tailwind, TanStack Table, and a database-backed worker. Reuse the actual supported stack found in the repository. Do not upgrade frameworks or replace authentication as a side effect of finance development.
Module boundaries
Use the existing application and database, with a distinct finance domain. Financial transactions link to existing project and user IDs, but amounts, bank details, and funding records live in restricted finance tables. Never add sensitive financial fields to ordinary project or employee response objects.
Route Handlers and Server Components call the same authorized services. One posting engine owns every journal posting. Reports read posted journal lines and dated subledger events; they never calculate financial statements by adding invoice totals and payments together.
Use existing outbox and job infrastructure for exports, private document generation, recurring draft creation, and depreciation preparation. Every worker rechecks authorization before producing or releasing a user-requested result. Reuse UI controls and domain services rather than maintaining duplicate finance-specific copies of shared infrastructure.
Decisions to record before live accounting
Decision
Implementation treatment
Finance owner identity
No name assumed; designated explicitly during controlled bootstrap
Fiscal year and cutover date
Required configuration before live opening balance import
Revenue recognition
Earned or deferred at line level, with reviewed recognition policy
Asset threshold and useful lives
Configurable; no legal or financial defaults asserted
Investment measurement
Per holding, approved policy; generic reviewed adjustments supported
Taxes and withholding
Configurable mappings; no guessed rates or automatic statutory filing
Record retention
Company-approved policy before deleting real supporting documents

These are launch configuration gates, not reasons to stop building independent features. Record unresolved decisions in docs/finance/decisions.md. The first milestone produces a gap analysis and an adjusted estimate. No production migrations, deployment, or real-data import are authorized merely by this build specification.

---

3 Access and financial confidentiality
Two conditions for finance access
A request is allowed only when its authenticated user is ACTIVE, has the current SUPER_ADMIN role, and has an active explicit finance grant. Recheck authoritative database state at each request. Do not trust a client flag or a long-lived cached role claim. No grant means no access, including for existing super admins.
User state
Finance records
Grant management
Member, lead, or HR admin
Denied
Denied
Super admin without finance grant
Denied
Denied
Selected super admin with active grant
Allowed
Denied unless designated finance owner
Finance owner with active grant
Allowed
Allowed through dedicated audited workflow
Inactive or demoted user
Denied immediately
Denied

Finance owner controls
Designate one finance owner through a controlled setup command bound to an explicitly identified active super admin. Bootstrap runs only while no owner exists, under a database lock; it creates the owner grant and audit event atomically. Never select the first visitor or all existing admins. Normal profile, role, invitation, and generic permission APIs cannot change finance grants or owner fields. Other admins cannot alter a selected finance user’s login email, credentials, MFA, or recovery settings to take over that identity; use authenticated self-service or the controlled recovery procedure.
Only the current finance owner can grant or revoke access for other eligible super admins. Require fresh authentication, MFA for live use, a reason, and an audit record. A normal selected super admin cannot grant themselves or anyone else finance access. Ownership transfer requires the current owner's authenticated action and the target's acceptance; until completed, the current owner remains responsible.
Prevent deletion, demotion, deactivation, or revocation of the last active finance owner through every generic user-administration path. Transfer first. Document a controlled operator recovery procedure with identity verification and audit evidence; do not expose a universal recovery endpoint.
Close every indirect path
Apply the same check to pages, API handlers, Server Components, aggregates, search/autocomplete, downloads, exports, saved views, background export delivery, and finance audit entries. General ERP audit logs may record that a restricted event occurred, but must not reveal amounts or financial payloads. Ordinary project responses and notifications contain no finance fields.
Use private, non-shared caching for authenticated finance responses; preferably no-store for sensitive reads. Permission revocation invalidates app access immediately for subsequent requests and blocks queued downloads. Already downloaded files cannot be remotely revoked. Database operators and backup administrators remain privileged infrastructure roles; application RBAC does not hide data from them.

---

4 Spreadsheet interface and frontend routes
Template B interaction contract
Open /finance to the Transactions register. Show compact totals above the table, a clear date/account filter, saved views, search, column selection, and New transaction. Do not replace this approved layout with a chart-heavy executive dashboard. Provide reports as a separate tab.
Registers use server pagination and sorting. Default 25 rows; maximum 100 per page. Preserve filters in the URL without embedding private notes. Show PKR and two decimal places; right-align amounts. Keyboard navigation, visible focus, accessible headers, 360-pixel mobile layouts, horizontal scrolling, and a detail drawer are required.
Route under /finance
Main content
/ and /transactions/[id]
Cash register, source links, status, detail drawer/history
/invoices and /bills
Customer and supplier documents, due dates, open balances
/payments
Receipts, outgoing payments, allocations, refunds, advances
/projects/[id]
Restricted contract, milestone, revenue, cost, and budget view
/funding
Capital, distributions, loans, repayments, contributors
/investments and /assets
Holdings, asset register, movements, depreciation
/accounts and /reconciliation
Bank/cash accounts, statements, matching, differences
/journals and /reports
Journal drafts, GL, trial balance, statements, ageing
/budgets and /settings
Budgets, chart of accounts, periods, policies
/access and /audit
Owner-only grant changes; restricted finance history

Table and drawer contents
Cash-register columns: posting date, reference, type, party, description, project, cash account, money in, money out, posting status, and reconciliation state. The register is a read model of cash movements, not a second editable accounting ledger. Noncash invoices, bills, and adjustments belong in their own registers and the GL.
Click a row to open Summary, Lines, Allocations, Journal, Attachments, and History. Drafts support validated inline edits with expectedVersion. Posting opens a confirmation showing totals, journal effect, and posting date. Posted values are read-only; explicit correction actions explain which reversal or credit will be created.
Bulk actions initially support draft categorization and draft archive only. Do not provide bulk post/delete of posted records. A failed batch is atomic and returns row-level errors. All screens need loading, empty, permission-denied, validation, stale-version conflict, and retry states. Report totals cover the filtered dataset, not just the visible page.

---

5 Screen examples and numeric meaning
All examples below are fictional and use PKR. Do not seed them into production.
Cash register example
Date
Reference
Type
Account
In
Out
11 Nov
CAP-001
Founder capital
Operating bank
500,000
—
11 Nov
RCPT-001
Client collection
Operating bank
200,000
—
11 Nov
PAY-001
Contractor payment
Operating bank
—
90,000
11 Nov
TRF-001
Transfer out
Operating bank
—
20,000
11 Nov
TRF-001
Transfer in
Petty cash
20,000
—

Both transfer legs appear in account-level activity, but company-level external receipts/payments exclude internal transfers. In this example, total company cash increases by 610,000, not by treating the extra 20,000 transfer-in as income. Label each summary as cash movement, collection, revenue, expense, or funding; do not use an ambiguous Income tile for all credits to a bank account.
Project finance example
Metric
PKR
Definition
Contract value
500,000
Signed commercial value; no automatic posting
Net invoiced
300,000
Posted invoice net of credits; tax shown separately
Cash collected
200,000
Posted customer receipts for this project
Outstanding invoice
100,000
Invoice remaining after dated settlement allocations
Earned revenue
250,000
Revenue recognized in the GL
Deferred revenue
50,000
Billed consideration for work not yet earned
Direct costs incurred
120,000
Posted project expense lines
Direct costs paid
90,000
Cash paid against those costs
Project contribution
130,000
Earned revenue less direct costs incurred

Project contribution excludes shared overhead and taxes unless explicitly allocated. Show unallocated overhead separately. Never calculate profit as full contract value minus paid costs. Tasks marked complete do not automatically recognize revenue; finance must use reviewed delivery evidence and the adopted policy.
Drawer example
A payment drawer shows party, payment date, posting date, bank, reference, gross settlement, bank fee, invoice allocations, remaining unapplied amount, evidence, and posting history. A cash receipt may be lower than the invoice settlement when a separately recorded fee or withholding explains the difference. The app must show that difference explicitly.

---

6 Accounting model and chart of accounts
Use accrual double-entry accounting. Each posted journal has at least two lines and equal debit and credit totals in PKR. Drafts have no financial effect. Debit and credit are not synonyms for money in and money out. Accounts carry a type, normal balance, report mapping, and optional control-account designation.
Range
Account group
Suggested examples
1000–1999
Assets
Bank, petty cash, receivables, advances, prepayments, investments, equipment
2000–2999
Liabilities
Payables, client advances, deferred revenue, loans, taxes payable
3000–3999
Equity
Founder capital, retained earnings, distributions, opening equity
4000–4999
Income
Development, design, retainers, investment income
5000–5999
Direct costs
Project contractors, allocated delivery wages, project services
6000–6999
Operating expenses
Rent, software, utilities, marketing, bank fees, depreciation
7000–7999
Other results
Disposal gains/losses, reviewed valuation changes, finance costs

These codes are proposed seed data, not an approved statutory chart. Separate accumulated depreciation as a contra-asset. Configure tax receivable/payable and opening clearing accounts. Mark cash-equivalent accounts explicitly; investments are not automatically cash equivalents.
Posting rules
Store money as PostgreSQL NUMERIC(20,2), not floating point. Accept decimal strings; reject scientific notation, NaN, excess precision, and out-of-range values. Use a decimal library for calculations. Rates and quantities use suitable higher precision, then round line results to two decimals using documented HALF_UP behavior. Calculate document totals from rounded lines; never accept client-supplied totals as authoritative.
Each line has exactly one positive debit or credit. Negative lines and zero/zero lines are rejected. Account currency and transaction currency must equal PKR. Require active posting accounts, an open period, a nonempty description, and the source reference. Account types and report mappings cannot change after use without a controlled reviewed reclassification.
Receivables, payables, bank/cash, advances, fixed assets, and investments are protected control accounts. Generic journals cannot bypass their registers. Provide typed adjustment workflows that update the relevant subledger and GL in one transaction. Ordinary adjustments to expenses, accruals, prepayments, deferred revenue, and taxes require a reason and supporting evidence.
Archive accounts instead of deleting referenced records. Balances are derived from posted lines; cached balances are disposable projections with reconciliation checks. Never expose an editable account balance field after opening initialization.

---

7 Posting lifecycle and transaction integrity
Lifecycle
Documents start DRAFT, then become POSTED or VOIDED. Only a draft may be edited or voided. A posted document may be REVERSED using a new opposite journal and dated reversal event; its original lines remain posted historical evidence. Invoice payment state is separately derived as UNPAID, PARTIAL, or SETTLED. Overdue is a date-based condition, not a posting status.
The UI uses Post, not Approve, unless an independent approval workflow is actually configured. Authorized finance users may post ordinary business entries with audit evidence. Do not claim that a user approving their own entry provides independent review. Any later maker-checker policy must require a different authorized person and must never silently bypass missing reviewers.
Atomic posting algorithm
1. Resolve current finance access and validate the input and idempotency key.
2. Lock the draft, its version, the posting period, and related settlement balances in deterministic ID order.
3. Recheck access under a grant-lock protocol shared with grant revocation; revalidate period, accounts, and document totals.
4. Build journal lines and typed subledger events; validate equal totals and every allocation limit.
5. Assign a unique server-generated reference; persist journal, lines, source state, allocations, audit, and outbox atomically.
6. Commit and return the canonical posted result. External email, file generation, and network requests run after commit.
Unique constraints prevent multiple postings for one source action. Reserve idempotency by actor, operation, key, and request hash. Same key and same input returns the existing result; same key with different input returns 409. Keep posting identities permanently, even if short-lived HTTP response caches expire. Retrying after a timeout must not post again.
Database enforcement
Use a reviewed PostgreSQL deferred constraint trigger or equally strong restricted posting function to enforce balanced posted journals at commit. Reject UPDATE/DELETE of posted journal lines through database triggers and restricted application privileges. Guard source/line mutation as well as header status changes. The application database role cannot disable these protections; migrations use a separate role.
Corrections and concurrency
Reversal records opposite lines with a reason, original reference, and an open posting date. Reverse related settlement effects atomically; block reversal of dependent documents until dependencies are resolved. Reports include original and reversal lines by their own dates, never discard the original from earlier reports because its current status says REVERSED.
Use expectedVersion on draft updates and one transaction for competing allocations. Period close and posting share the same period-lock protocol so a posting cannot slip into a closed period. Financial events are immutable; linking a correction is a controlled metadata change, not rewriting the original amounts.

---

8 Clients invoices receipts and revenue
Invoices and recognition
Reuse an existing client entity if suitable; otherwise create a finance party linked to a client profile. Invoice fields include client, project, invoice date, posting date, due date, reference, lines, description, quantity, unit price, explicit discount, tax code, and recognition treatment. Freeze posted party name/address and commercial details as a document snapshot.
A signed contract or milestone plan does not create revenue. For an earned service invoice, post debit Accounts receivable and credit Service revenue, plus any configured tax liability. For billed but unearned work, credit Deferred revenue instead. A reviewed recognition entry later debits Deferred revenue and credits Service revenue, with project and invoice-line references. It cannot recognize more than the deferred balance. Unbilled earned work, if required by policy, uses a reviewed accrual and later reversal to avoid duplicate recognition.
Receipts and allocations
A receipt records actual bank/cash received, client, project where known, dates, reference, and invoice allocations. Apply it to posted invoices of the same party and currency. One receipt may cover several invoices; an invoice may receive several receipts. Lock affected balances to prevent over-allocation. Allocate only posted, unreversed amounts effective on or before the allocation date.
Unallocated receipts become client advances, not sales revenue. On later allocation, transfer the applied amount from Client advances to Accounts receivable. Store that allocation journal and event; the bank balance is not affected again. If a receipt mixes invoice settlement and an advance, split the posting explicitly.
Credits refunds and fees
A customer credit note references invoice lines, reverses the appropriate revenue/deferred revenue and tax amounts, and reduces receivables. Cumulative credits cannot exceed eligible original amounts. If already paid, the credit creates a refundable customer balance or is applied to another eligible invoice through a dated allocation. Refund debit is to the customer credit/advance balance, with credit to bank; never create a new expense for a sales refund.
For a 10,000 invoice settled with 9,800 cash and a 200 bank/platform fee: debit Bank 9,800, debit Fees 200, credit Receivables 10,000. A withheld tax is not automatically a fee; use the configured withholding receivable with evidence and a policy-approved mapping.
Documents and delivery
Generate private printable invoice and credit-note PDFs. Download is authorized; email sending requires an explicit action and recipient confirmation. No automatic client email during development. Keep invoice numbering unique and never reuse a voided number. Posting dates cannot be in the future; future expectations belong in milestones or forecasts.

---

9 Expenses bills payments and taxes
Supplier and employee costs
Bills record supplier, supplier reference, bill/posting/due dates, lines, project allocations, category, taxes, and evidence. A posted bill debits Expense, Prepayment, or Asset as appropriate and credits Accounts payable. Paying it debits Payables and credits Bank. Do not record the payment as a second expense.
Immediate expenses combine expense recognition and cash payment in one source workflow. They still use the common posting engine. The UI must prevent users from recording an immediate expense and separately paying the same bill. Flag duplicate supplier reference/amount/date combinations for review; enforce deterministic uniqueness where the supplier reference is reliable.
Cost type
Required treatment
Project contractor
Expense line with project and supplier
Staff salary payment
Manual approved expense/payable; no attendance-derived payroll
Annual software prepaid
Prepayment asset with reviewed periodic expense releases
Laptop or equipment
Asset register and capitalization policy
Refund from supplier
Supplier credit and receipt linked to original cost
Founder paid a company bill personally
Expense/asset against founder payable; repayment clears that payable

Personal outlays are not automatically capital contributions. Record the agreed classification and contributor. Employee-related finance fields stay out of ordinary employee APIs, even when an expense references a user ID.
Advances credits and scheduling
Supplier advances debit Supplier advances and credit Bank. Applying an advance to a bill debits Payables and credits Supplier advances. Supplier credits reverse the original expense/asset and tax mapping with an eligible-amount cap. Refunds clear supplier credit balances. Partial settlement and cancellation use the same dated allocation rules as customer documents.
Recurring rent and subscription schedules create draft bills only, once per recurrence key. They do not claim payment occurred. Actual bank payments require explicit posting evidence. A future due date does not permit a future-dated actual payment.
Tax configuration boundary
Provide optional tax codes with effective dates, decimal rates, inclusive/exclusive mode, rounding rule, and input/output account mapping. Default to no tax until configured. Withholding can reduce cash settlement while leaving a tax receivable or payable. It must participate in the settlement equation so invoices are not falsely marked unpaid or overpaid.
Do not infer rates from location, implement filing deadlines, or label outputs tax-compliant. Configure company-approved codes and validate representative invoices with the accountant. Advanced statutory invoices, e-filing, payroll deductions, and jurisdiction-specific returns require a separate confirmed specification. Posting always preserves the actual code and rate snapshot used.

---

10 Founder capital loans and distributions
Separate funding from business revenue
Track contributors as parties, optionally linked to existing users. A capital contribution debits Bank and credits Founder capital. A loan received debits Bank and credits Loan payable. Neither increases service revenue or operating profit. Store evidence, contributor, dates, amount, bank account, and funding classification.
Capital returned to owners and distributions use reviewed equity accounts and explicit authorization evidence. The software records approved transactions; it does not decide whether a distribution is legally available. Never derive ownership percentages from contribution amounts. If ownership percentages are stored for reference, they are separately maintained effective-dated records backed by company documents.
Loan register
Each loan contains lender/borrower, direction, principal, start date, maturity, optional rate, agreement reference, ledger account, and status. Support founder loans to Encova and loans made by Encova. A loan advanced by Encova is an asset, not an expense. Avoid mixing these two directions in one Total loans number.
Record disbursements, principal repayments, interest accruals, interest settlements, and reviewed adjustments as separate movements. Repayment principal reduces the loan balance; interest is recorded separately as finance cost or income according to the adopted policy. Do not infer amortization from a single interest-rate field. Release one supports manual schedules and reviewed accruals rather than an unverified automatic lending calculator.
Founder register example
Contributor
Capital
Loans to company
Principal repaid
Loan remaining
Founder A
500,000
100,000
25,000
75,000
Founder B
300,000
0
0
0
Total
800,000
100,000
25,000
75,000

All figures are illustrative PKR amounts. Distributions and capital returns appear in separate columns or views. Outstanding principal is derived from posted movements; it is not an editable total.
Integration safeguards
Cash-funded movements must reference a cash/bank leg. Noncash contributions require a reviewed asset-side posting and are excluded from cash-flow totals. Contributor deletion is blocked after use; archival preserves the history. Corrections reverse both funding movement and journal. Repayments cannot exceed the applicable posted principal unless an explicit separate interest or advance component explains the excess.

---

11 Company investments and fixed assets
Investment holdings
Include company-owned investments as a distinct register: holding name, issuer/counterparty, type, acquisition date, units where applicable, cost, carrying amount, policy, classification, evidence, and linked ledger account. All bookkeeping is PKR. Reject foreign-currency transaction records; multi-currency conversion is outside this release.
Support acquisition, additional purchase, partial/full disposal, income receipt/accrual, impairment, valuation adjustment, and reversal. Holding balances come from movements and linked journals. Store original cost, current carrying value, realized result, and separately recorded valuation changes; do not combine them into one Investment profit field.
Use explicit lot selection for disposals and validate units/carrying value under a holding lock. Prevent disposal of more than the remaining quantity or cost basis. Disposal removes the selected carrying amount and records proceeds and the resulting gain/loss; fees are separate lines. Non-unit investments use amount-based movements with equivalent over-disposal checks.
Financial instruments can require different measurement and income/OCI treatments under the applicable framework [3]. Therefore the software must store a reviewed policy per holding and support accountant-reviewed balanced adjustment entries. Do not implement a universal cost-only or mark-to-market rule, automatic market prices, derivatives valuation, or investment recommendations. Unsupported measurement policies remain flagged pending configuration; do not silently report an arbitrary valuation as compliant.
Fixed asset register
Track equipment separately from financial investments. Store asset tag, description, location/custodian, purchase source, cost, in-service date, useful life in months, residual value, depreciation method, accumulated depreciation, and disposal data. A purchase linked from a bill must not post the asset cost twice.
Release one implements straight-line monthly depreciation with a defined full-month convention beginning in the configured first depreciation month. Confirm this convention before use. Depreciable amount is cost minus residual; distribute exact paisa amounts across scheduled months and place the remainder in the final month. Never depreciate below residual. Each asset/month has one posting key.
Generate depreciation drafts for review; do not silently post scheduled charges. Adjustments, impairment, disposal, and policy changes require dated movements and journal evidence. A fully depreciated asset stays on the register until disposed. Disposal clears cost and accumulated depreciation and records the resulting gain/loss. IAS 16 provides the underlying distinction between recognition, carrying amounts, and depreciation [4]; this application does not determine the company’s reporting framework.

---

12 Projects budgets and cost allocation
Project finance profile
Link to the ERP project through its existing immutable ID. Store commercial terms, client, contract amount, signed variations, billing model, payment milestones, finance status, and budget in restricted finance records. Show the Finance tab only to selected super admins; a project manager gains no finance rights merely by managing the project.
Fixed-price projects use milestone billing; time-based projects may record approved quantities and rates manually. This finance release does not introduce a payroll or timesheet engine. Project tasks or attendance events cannot trigger invoice posting, revenue recognition, or wages without explicit approved finance actions.
Report definitions
Metric
Source and calculation
Contract value
Initial agreement plus approved variations
Net invoiced
Posted invoice lines less eligible credits, excluding tax
Collected cash
Posted receipt cash legs attributed to project
Invoice outstanding
Dated AR events and allocations for project documents
Earned revenue
Posted income lines mapped to project
Direct costs
Posted expense lines assigned to project
Project contribution
Earned revenue minus direct costs
Fully allocated result
Contribution minus documented overhead allocation
Budget remaining
Approved cost budget minus actual incurred costs

Collection and settlement differ where fees, withholding, advances, or credits exist. Show each component separately. Contract remaining-to-invoice is a commercial estimate and must not be used as receivables or revenue.
Allocation rules
Split a source cost into exact project lines plus an optional shared-company line. Split amounts must sum to the original cost. For percentage input, calculate decimal amounts and assign the rounding remainder deterministically, showing the result before posting. Prevent double allocation.
Reclassifying a posted shared expense to projects uses a balanced project-dimension reclassification journal: debit the expense with target project and credit the same expense with the original dimension. Company profit remains unchanged. Finance-only cost rates and salary allocations must never appear in ordinary team reports.
Budgets and forecasting
Budgets are approved versioned plans by month, project, and expense account/category. Actuals use posted expense activity on the same basis and dates. Show unpaid bills as incurred cost, not merely paid cost. Forecast receipts/payments have their own dates and likelihood notes; they do not post to the ledger. Budget changes preserve the previous version and reason.
Budget warnings are advisory initially. Do not block required accounting recognition because a budget is exceeded. Archived operational projects retain finance history and can receive valid settlements or corrections; archive does not prevent collecting an outstanding invoice.

---

13 Bank reconciliation and period controls
Account setup and statement imports
Each bank/cash account maps to one PKR GL account. Store a display name, institution, optional masked reference, and active status; never store online banking credentials. Account balances are journal-derived. Opening cash is posted through the opening-balance process, not an editable field.
CSV imports use preview, column mapping, date/amount validation, duplicate detection, and explicit commit. Initial limits: 5 MB and 5,000 rows, with bounded processing. Retain file hash, import key, row fingerprint, statement account, dates, and opening/closing totals. Exact re-imports return the previous batch; possible cross-file duplicates require review rather than silent deletion.
Bank statements are evidence, not automatic new income. Match statement lines to existing posted cash movements. Support one-to-many and many-to-one matches through allocation rows; total matched amounts cannot exceed either side. Store debit/credit direction consistently and validate account and currency. Do not automatically match merely because dates and amounts happen to agree.
Create a new fee/payment entry from an unmatched statement only through the normal reviewed posting workflow. Reconciliation itself does not post a duplicate journal. Unmatch preserves a reversal event and reason. Reversed cash entries require reconciliation resolution before reversal can complete.
Reconciliation result
For a statement cutoff, show statement balance, posted GL bank balance, outstanding deposits, outstanding payments, unresolved items, and explained difference. Mark reconciled only when the reconciliation equation is zero and every outstanding item is documented. Use bank value date for statement placement and posting date for GL reporting; preserve both.
Month and fiscal year close
Monthly close checks balanced trial balance, AR/AP control agreement, bank reconciliation, advance/asset/investment roll-forwards, unresolved posting failures, pending adjustments, and opening-clearing balance. Capture a close checklist and report snapshot. The finance owner can close or reopen with fresh authentication and a reason. Locking blocks posting, reversal, and allocations effective in that period.
Fiscal-year close generates one idempotent closing journal that transfers net income and expense balances to retained earnings. Label it as YEAR_CLOSE. P&L excludes those closing lines when showing operating results; GL and trial balance include them. The balance sheet includes retained earnings plus unclosed profit exactly once. Reopening a closed year requires reversing its closing journal through a dedicated controlled workflow before accepting year adjustments, then re-closing.
Preserve report snapshots and mark them superseded when a period is reopened. Never silently rewrite a previously issued report. Opening balances at cutover must reconcile subledgers and cannot coexist with re-imported historical postings that duplicate the same balances.

---

14 Financial statements and reporting contracts
Every report displays company, PKR, reporting dates, accounting basis, generation time, filters, and posting cutoff/snapshot. Financial statements exclude drafts. Use a consistent database snapshot so totals and detail agree during concurrent posting. Export the same dataset and filters as the screen.
Report
Required behavior
General ledger
Opening balance, chronological debit/credit lines, running balance, source links
Trial balance
Opening, period movement, closing debit/credit; totals must balance
Profit and loss
Income, direct costs, operating costs, other results, tax expense if recorded, net result
Balance sheet
Assets, liabilities, equity, unclosed earnings; difference must equal zero
Cash flow
Direct cash movements by operating, investing, financing; tie opening to closing cash
Receivables and payables
As-of open amounts, due dates, current and overdue ageing buckets
Project results
Recognized revenue/costs, contribution, allocated overhead, commercial metrics
Funding and investments
Posted movement roll-forwards and carrying/principal balances
Budget variance
Approved budget versus incurred expense for the same scope

Date and reversal correctness
Use accounting DATE fields in Asia/Karachi for posting/report dates and UTC timestamps for event history. Ageing buckets: not due, 1–30, 31–60, 61–90, and over 90 days past due. Due today is not overdue. Reconstruct AR/AP as of the cutoff using dated allocations, credit events, and reversals; do not subtract payments posted after that date.
A reversed invoice remains in the earlier report before its reversal date. A reversed allocation likewise remains effective until the dated unallocation event. Keep invoice and payment state labels separate from historical financial calculations.
Cash flow classification
Cash flow categories are stored on cash-movement components with a reviewed mapping. Internal transfers between included cash-equivalent accounts net to zero and are excluded from external cash flows. Split mixed settlements into operating, investing, and financing components; do not classify an entire batch from one header. Noncash adjustments do not appear in cash flows. Require classified cash components to sum to the posted cash change.
Prevent misleading totals
At company level, assets equal liabilities plus equity including current unclosed profit. At project level, do not present a filtered balance sheet as a complete company statement. When a mapping or reconciliation is missing, show an explicit incomplete-report status and block a final export; never hide the difference in an unexplained balancing account.
Profit and loss and balance-sheet reports are accounting outputs from configured records, not automatically audited or statutory statements. Reports should be downloadable as CSV and private printable PDF, with page headers, column headings, and totals preserved.

---

15 Core database schema
This is a logical schema contract. Codex must implement validated migrations in the existing schema style and document actual names. All finance tables use UUID primary keys, server timestamps, and foreign keys. Mutable drafts have version integers. Posted amounts and events are immutable. Use NUMERIC(20,2) for PKR and explicit CHECK constraints.
Entity
Required fields and constraints
FinanceSettings
Singleton; PKR CHECK; owner_user_id; cutover_date; fiscal_year_start; policy_version; live_enabled
FinanceGrant
user_id; granted_by; granted_at; revoked_by/at; reason; one active grant per user
FinanceOwnershipTransfer
current_owner; target_owner; expiry; accepted_at; status; audit reference
FinanceAccount
code unique; name; type; normal_side; report_group; control_type; parent_id; active
CashAccount
name; gl_account_id unique; currency PKR; bank/cash type; masked_reference; active
FinancePeriod
start/end dates; state; closed/reopened metadata; no overlapping periods
FinanceParty
kind; legal/display name; contact snapshot source; optional user/client link; archived_at
FinanceDocument
type; reference unique; party/project; dates; currency; totals; state; version; source snapshot
FinanceDocumentLine
document_id; sequence; description; quantity/rate; net/tax/gross; account; project; recognition
JournalEntry
posting_date; source_type/id/action; reference; state; posted_by/at; reversal_of unique nullable; kind
JournalLine
journal_id; account_id; debit; credit; party/project; subledger reference; description
FinancePostingKey
operation; source_id; unique action key; request hash; journal/result reference
FinanceAuditEvent
actor; action; target; time; reason; safe diff; request_id; finance-restricted payload

Core constraints
Journal lines enforce one positive side and nonnegative values. A commit-time balance check covers all posted journals, including opening, closing, reversal, adjustment, and generated entries. Unique source/action constraints prevent duplicate posting. Foreign keys use RESTRICT for referenced accounting records; do not cascade-delete financial history when an ERP user or project is removed.
Financial documents include typed invoice/bill/credit metadata and line snapshots. Do not place every entity in an unvalidated JSON blob. JSON is appropriate for immutable source snapshots and narrowly versioned settings, with schema validation.
Index journal lines by account and journal, entries by posting_date/id, documents by party/due_date/state and project, grants by user/revoked_at, and audit by target/time. Query plans and realistic seeded volume determine additional indexes; do not precompute mutable truth in multiple independent balance fields.

---

16 Settlement and supporting schema
Entity
Required fields and constraints
Payment
direction; party; cash_account; gross settlement; cash amount; fee/withholding; date; journal
SettlementEvent
payment/credit/advance source; target document; amount; effective_date; reversal_of; journal if needed
CashMovement
journal_line; component amount/direction; classification; project/party; transfer_group
ProjectFinance
project_id unique; client; contract value; variations; finance status
BillingMilestone
project_finance_id; description; value; expected/due dates; linked invoice lines
FundingMovement
contributor; CAPITAL/RETURN/DISTRIBUTION; amount; date; journal
Loan and LoanMovement
direction; counterparty; principal terms; movement kind; amount; date; journal
InvestmentHolding
classification; policy; GL account; quantity basis; status; optional counterparty
InvestmentLot and Movement
holding; acquisition lot; units; cost/carrying value change; proceeds; date; journal
FixedAsset and AssetMovement
cost/source; in-service date; life/residual; movement type; date; journal
DepreciationSchedule
asset; month; amount; state; journal; unique asset/month
Budget and BudgetLine
approved version; period/project/account; amount; superseded reference
ForecastItem
expected_date; in/out; amount; source; assumptions; excluded from GL
BankImport and StatementLine
account; file hash; import key; source line; dates; amount; fingerprint
Reconciliation and MatchEvent
statement/GL components; matched amount; cutoff; reversal event; actor
FinanceAttachment
object key; target; original name; MIME/size/hash; scan state; uploader; retention
TaxCode
effective dates; rate/mode; account mappings; version; active
ReportSnapshot and ExportJob
type; filters; posting cutoff; object key; requested_by; state; expiry

Supporting integrity
Settlement limits must be checked under locks, not through an unlocked read-then-write. Settlement reversal is a new dated event. Advance application creates the required GL transfer; ordinary allocation within the same control balance must not duplicate receipt postings. Party balances and control totals reconcile by effective date.
Investment and asset adjustments update movement records and journals together. Depreciation uses a permanent unique asset/month key. A recurring schedule similarly has a unique schedule/period draft key. Bank matches lock both sides and prevent overmatching. Stored statement lines are immutable; correction imports retain the previous batch and explain replacement handling.
CashMovement is a validated projection of posted cash lines, not a separate source of cash truth. Every component must reconcile to its journal line. Restrict unique/multiple mappings explicitly and test mixed fees, transfers, and allocations. Attachments never store public URLs; use private object keys and authorized access.

---

17 API contracts and validation
Use the existing API convention; proposed prefix is /api/v1/finance. Every endpoint requires current finance authorization, except ownership acceptance which additionally checks its intended target. IDs are UUIDs. Monetary input/output uses decimal strings. Server-generated totals are canonical.
Route group
Required operations
/access and /ownership-transfers
Owner-only grants/revokes; initiate/accept owner transfer
/accounts /cash-accounts /parties
Scoped list/detail; validated create/update/archive
/invoices /bills /credit-notes
List/create; detail/update draft; post; void draft; reverse where permitted
/payments /advances /transfers
Create/list/detail; post; allocate/unallocate; reverse
/journals /adjustments
Draft CRUD; preview; post; reverse; typed control adjustments
/projects/:id
Finance profile, milestones, variations, budget, financial results
/funding /loans /investments /assets
Registers, typed movements, post/reverse, schedules
/bank-imports /reconciliations
Preview/commit imports; suggest/match/unmatch; finalize
/periods /year-close
Close/reopen; preview/post/reverse year close; checklists
/reports/:type and /exports
Filtered report; create export; authorized status/download
/attachments and /audit
Upload/finalize/download; restricted history

Implement concrete REST paths and request/response schemas in docs/finance/api/openapi.yaml. The route group table is not permission to create ambiguous catch-all actions. Source types and transitions must be explicit and validated.
Common contract
List query: page=1, pageSize=25, allowlisted sort, q, dateFrom/dateTo, accountId, projectId, partyId, and state. Cap search length at 100 characters and page size at 100. Stable sorting includes ID. Reject unknown filters instead of passing raw SQL expressions.
Mutation headers: Idempotency-Key for create/post/reverse/import/settlement. Mutable input includes expectedVersion. Return 201 for create, 200 for a successful action, 400 for malformed input, 401 for no session, 403 for absent finance capability, 404 for unavailable record, 409 for state/version/idempotency conflict, 422 for domain validation, and 429 for rate limiting. Errors use {error:{code,message,fields,requestId}} without private financial values in generic logs.
Receipt input example
{"partyId":"<uuid>","cashAccountId":"<uuid>",  "postingDate":"2026-11-11","currency":"PKR",  "cashAmount":"9800.00","feeAmount":"200.00",  "allocations":[{"invoiceId":"<uuid>","amount":"10000.00"}],  "reference":"BANK-REF-001","expectedVersion":1}
Validate the settlement equation and account mappings on the server. Currency other than PKR is rejected. The client cannot submit postedBy, owner identity, arbitrary journal lines through a receipt route, or a trusted balance override.

---

18 Folder structure and system flow
Adapt these paths to the existing project. Reuse its package manager and conventions. Create modules when implementing their features; do not fill the repository with empty abstractions. Finance source files remain server-only where they contain database queries or financial policies.
src/app/(workspace)/finance/   page.tsx  loading.tsx  error.tsx   invoices/  bills/  payments/  projects/[id]/   funding/  investments/  assets/  accounts/   reconciliation/  journals/  reports/  budgets/   settings/  access/  audit/ src/app/api/v1/finance/   [concrete resource routes]/route.ts src/modules/finance/   access/       policy, grants, ownership, audit   accounting/   posting, journals, accounts, periods   receivables/  invoices, credits, receipts, allocations   payables/     bills, credits, payments, advances   treasury/     cash, transfers, reconciliation   funding/      capital, distributions, loans   investments/  holdings, lots, movements   assets/       assets, depreciation, disposals   projects/     contracts, milestones, cost allocation   reporting/    statements, ageing, snapshots, exports   documents/    private attachments and invoice PDFs   components/   FinanceTable, MoneyCell, DetailDrawer prisma/migrations/   additive reviewed migrations scripts/finance/    bootstrap, reconcile, verify-opening tests/finance/      unit, integration, e2e, fixtures docs/finance/       specification and implementation evidence
Within each module use schemas.ts, dto.ts, policy.ts, queries.ts, service.ts, and feature components only when needed. Posting is shared; no independent handwritten journal logic in individual UI routes.
Mermaid architecture source
flowchart TD   UI[Finance registers] --> API[Authorized request handlers]   API --> G[Role and finance grant check]   G --> S[Finance services]   S --> P[Atomic posting engine]   S --> R[Snapshot report queries]   P --> DB[(PostgreSQL ledger and subledgers)]   R --> DB   P --> A[Restricted audit and outbox]   A --> W[Background worker]   W --> F[Private files and exports]   API --> F
The documentation pack includes this diagram as editable Mermaid source. All access paths, including direct server-side report queries and file downloads, must enforce the finance policy.

---

19 Security attachments and operational readiness
Sensitive records and files
Use the existing secure session, CSRF protection, server-side validation, and shared rate limits. Require MFA and recent reauthentication for finance ownership/access changes, period reopen, and live finance setup. Ordinary finance users must not reach grant-management mutations through generic admin update routes.
Allow PDF, JPEG, and PNG evidence only initially; maximum 10 MB per file and 10 attachments per document. Validate actual type, randomized object key, size, hash, and upload completion. Quarantine until malware scanning succeeds; if the scanner is unavailable, leave files unavailable rather than treating them as clean. Serve with safe content disposition and private cache headers. Do not allow HTML, SVG, executable files, or arbitrary remote URL fetching.
Attachment download checks current access through an authenticated proxy for strict revocation. Never store receipts in a public bucket. Generated reports and PDFs follow the same rule. Delete abandoned draft uploads through a documented retention job; retain posted evidence according to the approved retention policy.
Background tasks and exports
Jobs have unique keys, leases, bounded retries, and visible failures. Workers cannot post a journal simply because a recurring schedule fired; they create reviewable drafts. Export jobs store requester and filters, check access at execution and download, and expire private artifacts. CSV exports neutralize formula-leading text while preserving numeric columns as numbers.
Migration and rollout
Use additive migrations first and keep finance behind a feature flag until verification. New grants default to absent. Do not assume every current super admin is authorized. Backfill links without touching historical ERP activity. Run existing ERP smoke tests alongside finance tests after each integration stage.
Use separate development, test, staging, and production databases. Never seed live financial examples. Validate backups by restoring into an isolated database and reconciling balances and document links. Restrict backup/object-store access and encrypt transport/storage using the deployed platform’s supported controls.
Opening balances
Import a dated reviewed trial balance plus open customer/supplier items, loans, investments, assets, and cash balances. Typed opening entries populate control subledgers and the GL exactly once. If unpaid invoice details are imported, they must not create a second receivable in addition to a trial-balance receivable total. Use a temporary opening-clearing account and require zero after reconciliation. Record source files, cutover date, approver, and reconciliation evidence.
No foreign-currency figures may be silently relabeled PKR. Mixed-currency historical books require a separately approved conversion plan outside this specification. Live rollout requires authorized deployment, reviewed opening balances, accounting policy signoff, and passing acceptance evidence.

---

20 Accounting acceptance fixture
Use this deterministic fixture in an isolated database, with zero opening balances, no tax, no overhead allocation, no depreciation, and all dates in one open period. All services are earned immediately in this example. Values are PKR. These are test expectations, not company balances.
Event
Debit
Credit
Founder contributes 500,000
Bank 500,000
Capital 500,000
Founder lends 100,000
Bank 100,000
Loan payable 100,000
Earned invoice 300,000
Receivables 300,000
Service revenue 300,000
Collect 200,000 against invoice
Bank 200,000
Receivables 200,000
Contractor bill 120,000
Direct costs 120,000
Payables 120,000
Pay contractor 90,000
Payables 90,000
Bank 90,000
Purchase equipment 60,000
Equipment 60,000
Bank 60,000
Purchase investment 50,000
Investments 50,000
Bank 50,000
Repay loan principal 25,000
Loan payable 25,000
Bank 25,000

Required final results
Result
Expected PKR
Bank
575,000
Receivables and payables
100,000 receivable; 30,000 payable
Equipment and investments
60,000 equipment; 50,000 investments
Outstanding loan
75,000
Profit
180,000 (300,000 revenue minus 120,000 direct costs)
Total assets
785,000
Liabilities plus equity
105,000 liabilities + 500,000 capital + 180,000 profit
Operating cash flow
110,000
Investing cash flow
Negative 110,000
Financing cash flow
575,000
Closing cash
575,000

Total journal debits and credits are each 1,445,000. Both the trial balance and balance sheet must reconcile. Link the invoice and contractor bill to one project: project contribution is 180,000, but project cash movement is 110,000. Equipment and investment purchases are not immediately expensed in this fixture.
Required follow-up scenarios
Post a 50,000 client advance: cash and liabilities increase by 50,000; profit stays unchanged. Transfer 20,000 from Bank to Petty cash: company cash and profit stay unchanged. Post a 30,000 customer credit for the original unpaid service invoice: revenue and receivables decrease by 30,000. Repeat each request with its original key: no additional posting occurs. Run these scenarios separately or reset expected totals explicitly between them.

---

21 Verification and definition of done
Required risk tests
Risk
Required evidence
Unauthorized finance access
Member, HR, lead, and unselected super admin denied on every surface
Privilege escalation
Generic role/profile APIs cannot create grants or change ownership
Revoked access
Next request and queued export denied; stale UI cannot mutate
Unbalanced or mutable ledger
Direct invalid DB writes rejected; posted lines cannot be edited/deleted
Duplicate posting
Concurrent same-key requests create one source posting and journal
Over-allocation
Competing payments/credits cannot exceed remaining balance
Period race
Concurrent close and post yield a consistent valid outcome
Historical accuracy
Future payment/reversal does not alter earlier as-of balances
Revenue and advances
Deferred revenue and client advances do not become profit on receipt
Control account agreement
AR, AP, cash, loan, asset, investment subledgers tie to GL
Asset and investment disposal
No negative holdings; gain/loss and remaining basis correct
Rounding
Fractional quantities/taxes/splits sum exactly in paisa
Reconciliation
Duplicate imports and many-to-many matching cannot duplicate cash
Closing
Year close idempotent; P&L remains readable; earnings counted once
Confidential files
Direct object links blocked; invalid uploads quarantined
ERP regression
Existing login, tasks, attendance, and project workflows remain valid

Use unit tests for pure calculations and transitions, real PostgreSQL integration tests for transactions/constraints, and browser E2E tests for complete user flows. Do not replace financial posting or DB tests with mocks. Test all accounting reports against known fixture results and source drill-down totals.
End to end acceptance journey
Bootstrap the designated finance owner in test data, grant a second eligible admin, verify denied users, create accounts and a project, post an invoice, receive a partial payment, post/pay a bill, add capital and a loan, buy an asset and investment, reconcile a statement, generate reports, close the period, and demonstrate a blocked backdated edit. Reopen through the owner workflow, make a traceable correction, and revoke the second admin’s access. Verify exports and file downloads are then denied.
A feature is complete only when UI, API, migrations, permissions, transaction behavior, error states, tests, and documentation agree. Record exact commands and outcomes; do not invent passing tests, screenshots, commit hashes, or accounting review. A successful build is not a financial launch approval. Confirm database restore and an accountant-reviewed representative dataset before real reporting.

---

22 Daily milestones from 1 to 24
Plan 48 focused milestones at approximately four hours each as an initial planning allowance, not a promised completion date. Full accounting can require more sessions. Re-estimate after F01 and F08 using repository evidence. Continue unfinished work on the same milestone on the next date; never mark a milestone complete because four hours elapsed.
Day
Work and completion evidence
F01
Inspect repository; document actual progress, gaps, dependencies, and revised estimate
F02
Add finance docs and feature flag; preserve existing ERP progress
F03
Build grants and shared access policy; denied-role integration tests
F04
Implement owner bootstrap/transfer/revoke; escalation and owner-lock tests
F05
Build accounts, periods, PKR validation, and reviewed migrations
F06
Implement posting engine and DB balancing/immutability safeguards
F07
Add idempotency, draft versions, reversals, and concurrency tests
F08
Run core accounting fixture subset; review design and re-estimate
F09
Build shared finance register, filters, pagination, drawer, error states
F10
Add parties, cash accounts, chart of accounts UI and validation
F11
Implement earned/deferred invoice schema and posting services
F12
Build invoice screens, lines, previews, and private printable invoice
F13
Implement receipts and partial/multiple invoice allocations
F14
Implement client advances and later application without duplicate cash
F15
Add customer credits, refunds, and settlement reversal tests
F16
Implement bills, immediate expenses, and category/project splits
F17
Implement supplier payments, advances, credits, and refunds
F18
Add configurable tax and withholding mappings with reviewed fixtures
F19
Build private attachment upload, quarantine, download, and access tests
F20
Build cash register and transfers; verify internal-transfer exclusion
F21
Implement capital, distributions, and founder-funded company costs
F22
Implement loan directions, principal/interest movements, and register
F23
Build investment holdings, acquisition lots, and movement services
F24
Build investment disposals, returns, adjustments, and over-disposal tests

Each day includes meaningful verification and documentation; do not defer all tests to the end. If an existing ERP prerequisite is missing, record it and implement the smallest necessary dependency within the adjusted plan. Do not replace existing user-management or project modules without explicit authorization.
The F-series is separate from the original ERP day numbers. Approval to work on finance does not authorize silently marking the existing ERP roadmap complete or replacing it.

---

23 Daily milestones from 25 to 48
Day
Work and completion evidence
F25
Build fixed asset register linked to purchases without duplicate postings
F26
Implement depreciation drafts, exact rounding, disposal, and reversals
F27
Add private project contracts, variations, and billing milestones
F28
Build cost allocation/reclassification and project result calculations
F29
Add versioned budgets, variance views, and separate forecasts
F30
Implement statement CSV preview/commit and duplicate protection
F31
Implement match/unmatch with partial and combined transactions
F32
Build reconciliation UI and statement-to-GL proof
F33
Build general ledger and trial balance with opening/running balances
F34
Build P&L and balance sheet with validated account mapping
F35
Build direct cash flow and mixed-payment cash classifications
F36
Build historical AR/AP ageing with dated settlement events
F37
Add project/funding/investment/asset report roll-forwards
F38
Add authorized CSV/PDF exports, snapshots, and export revocation tests
F39
Build monthly close/reopen checklist and posting-lock concurrency
F40
Implement year close/reversal; verify retained earnings without duplication
F41
Implement opening subledger and trial-balance import with clearing proof
F42
Add recurring draft jobs, accrual/recognition adjustments, and job recovery
F43
Run complete accounting fixture and rounding/credit/advance edge cases
F44
Run full access, attachment, permission-revocation, and ERP regression suite
F45
Complete browser journey, keyboard/mobile checks, and error recovery fixes
F46
Rehearse additive migration, restore, rollback, and document deployment
F47
Review representative reports and policies with company/accountant; record gaps
F48
Review acceptance evidence and remaining risks; request separate launch decision

Working rhythm
Use roughly 20–30 minutes to understand the day’s goal, most of the session for implementation, and the remaining time for verification, explanation, and documentation. A failed check or unclear accounting assumption is recorded as a blocker or open decision. Do not invent a workaround that makes the balance appear correct while losing accounting meaning.
Work on one active planned day at a time. Ask Talha before advancing to the next day unless that exact advancement was already approved. A request for status is not authorization to start new work. A general “continue” resumes the current unfinished day; if it is complete, confirm advancement before starting the next milestone.
One planned day per Asia/Karachi calendar date is the default inherited learning workflow. Talha can explicitly approve a different pace. Preserve actual dates and effort rather than retroactively pretending a 48-day roadmap was followed. The milestone count is a planning tool, not a productivity score or a guarantee.

---

24 Documentation handoff and source references
Required documentation structure
docs/finance/   README.md  specification.md  decisions.md   progress.md  repository-assessment.md  risks.md   product/       scope.md  screens.md  permissions.md   architecture/  overview.md  folders.md  system.mmd   accounting/    policies.md  posting-rules.md  reports.md   database/      schema.md  migrations.md  opening-balances.md   api/           contracts.md  openapi.yaml   testing/       acceptance.md  fixtures.md  results.md   operations/    setup.md  deployment.md  backup-restore.md   planning/      milestones.md  backlog.md   planning/days/ F01.md through F48.md
The supplied pack contains proposed scope and pending templates, not implemented services. Codex creates the actual OpenAPI contract while building endpoints. Merge the supplied documentation with existing files; do not overwrite repository AGENTS.md or its completed progress. Add a finance section/link to the main progress index.
Instructions to Codex
Read START_HERE.md, this specification, and repository instructions. Inspect the existing ERP and current progress before coding. Implement this finance extension in the actual stack, preserving completed work. Begin with F01; do not assume anything in the old ERP specification has been implemented. Keep existing ERP progress and finance progress separate.
After each meaningful change, update the current day with completed tasks, files changed, tests actually run, outcomes, unresolved issues, remaining work, and the next exact action. Record accounting assumptions and explain important backend decisions to Talha. Mark a day complete only when its acceptance checks pass and the learning check is recorded. Ask before advancing. Never expose live financial data, credentials, or private receipts in documentation.
Initial finance progress: total milestones 48; completed 0; current F01; status Pending; remaining 48; implementation evidence None; next-day approval Not requested. Existing ERP completion is user-reported approximately 20 percent and unverified. Answer “Where are we?” using actual progress files, repository evidence, blockers, and approval state.
Research basis and limits
The sources below informed report separation, correction history, and accounting policy boundaries. All Encova-specific access, schemas, routes, and milestones are proposed implementation requirements. Sources accessed 11 November 2026; no claim of tax certification or statutory compliance is made.
[1] ERPNext Accounting Reports — https://docs.frappe.io/erpnext/accounting-reports
[2] ERPNext Immutable Ledger — https://docs.frappe.io/erpnext/immutable-ledger-in-erpnext
[3] IFRS Foundation IFRS 9 Financial Instruments — https://www.ifrs.org/issued-standards/list-of-standards/ifrs-9-financial-instruments/
[4] IFRS Foundation IAS 16 Property Plant and Equipment — https://www.ifrs.org/issued-standards/list-of-standards/ias-16-property-plant-and-equipment/
Before live reporting, validate policies and example postings against Encova’s applicable framework with its accountant. Codex must not invent tax rates, ownership percentages, opening balances, or investment valuations.
