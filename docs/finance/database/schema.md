# Implemented finance schema

FinanceGrant: UUID id and Person user/issuer/revoker references (ON DELETE RESTRICT), grant/revocation timestamps, bounded reason, positive version. A PostgreSQL partial unique index permits only one unrevoked grant per person; revocation actor/time must be paired and not precede grant time. Revoked history can be retained alongside a subsequent grant.

FinanceAuditEvent: UUID id, restricted Person actor reference, action, entity type/id, reason, JSON data, request UUID and timestamp. UPDATE/DELETE are rejected by a database trigger. Append writes are not routed into ordinary ERP Audit. Validated service payload schemas will accompany actual owner/posting operations; this table is not an arbitrary finance API.

Both tables have RLS enabled, no anon/authenticated grants and restricted encova_app grants. Runtime: SELECT FinanceGrant; SELECT/INSERT FinanceAuditEvent. The migration seeds zero rows. Owner/settings control tables are described below; ledger/subledger tables remain pending. The FinanceGrant partial uniqueness constraint lives in reviewed SQL because Prisma schema syntax does not represent it.

## F04 control schema

FinanceSettings is a UUID singleton with PKR CHECK, current owner Person, owner grant (including a composite FK to the same Person), positive version and server timestamps. FinanceOwnershipTransfer references current/target Persons, has a 24-hour expiry, constrained state/acceptance metadata, version and one pending-transfer partial unique index. FinanceAccessReceipt has a unique actor/operation/key, server-computed canonical JSON SHA-256 request hash, canonical result and immutable history trigger; no credentials are stored.

Database triggers block owner deletion/demotion/deactivation/grant removal and validate owner eligibility and an active matching grant. Selected accounts' email/provider bindings are protected; only the existing verified self-email synchronization can set a transaction-local self-service marker for email (never replacement provider IDs). Runtime reads control tables and invokes the dedicated owner-checked command; it cannot invoke operator setup/recovery. These are control records, not an accounting ledger or monetary source.

## F05 setup schema

FinanceAccount stores a unique retained uppercase code (2–20 characters), name, typed classification/normal side/report group/control type, PKR, optional parent group, posting/contra/cash-equivalent flags, active state, positive version, optional first-used marker and timestamps. There is no balance column. SQL checks enforce normal/contra compatibility and control/group restrictions; a serialized hierarchy trigger prevents cycles, incompatible parents, posting parents and active children under archived parents. Used account/ancestor mappings freeze; labels remain correctable. No DELETE path exists.

FinancePeriod stores an explicit inclusive start/end DATE, OPEN/CLOSED/VOID state, first-used marker, future close metadata, version and timestamps. GiST exclusion on daterange(startDate,endDate,'[]') for non-VOID rows prevents any overlap without an extension. Both dates are real calendar dates within years 0001–9999. Only OPEN setup can be amended; unused OPEN periods may be voided without deletion. Used dates cannot change/void. Close/reopen behavior is reserved for F39.

FinanceSetupReceipt permanently binds actor/operation/key to server-canonical JSON SHA-256 and original {id,version}; its immutable trigger and the finance-only before/after audit commit with the configuration. No passwords, MFA codes, session IDs or monetary entries appear in these records. Runtime is SELECT-only on all three tables plus EXECUTE on the narrow owner-checked setup command; anon/authenticated have neither table nor function access. Migration operator privileges are a separate trust boundary.

## F06–F10 ledger and master schema

FinanceJournalDraft and FinanceJournalDraftLine hold typed versioned manual source records. FinanceJournalEntry/FinanceJournalLine hold only immutable posted history with unique source/action, source draft or unique reversal link, open period, user/project/account RESTRICT references and NUMERIC(20,2) sides. Deferred checks enforce positive balanced totals, cardinality and source/opposite-line correspondence at commit. Used mapping/date markers are written atomically; no cached balance is authoritative. FinanceLedgerReceipt permanently retains actor/operation/key hash and canonical result. Restricted audit snapshots retain each draft revision with amounts as decimal strings.

FinanceParty contains bounded legal/display/contact data, kind, optional existing Person binding, archive state, version and future first-use marker. FinanceCashAccount contains name/kind, one unique protected CASH GL reference, PKR, optional four digits, state/version. They never add money fields to Person/Project DTOs and store no full bank number or balance. Used identity/mapping guards and retention FKs prevent silent replacement/deletion. All new tables use Finance prefix so runtime replay cannot give them generic ERP CRUD.

Runtime gets SELECT plus EXECUTE only on the current-session checked ledger/master commands. RLS/Data API roles deny all new financial tables/functions. The migration/operator role remains privileged and separate. Closing/reopening and commercial document/subledger schemas are future milestones.

## F11 invoice and dated billing schema

FinanceInvoice stores unique server-generated number, optional external reference, client/AR/project references, three date-only fields, evidence/description, PKR, draft/posted/voided state, optimistic version, exact independently computed totals and frozen posted party contact snapshot. FinanceInvoiceLine stores typed quantity/rate, explicit discount, gross/net/zero-tax/total, earned/deferred treatment and revenue/deferred/project references. Posted header/lines are immutable; retention FKs prohibit deletion of source relationships.

FinanceJournalEntry adds unique invoiceId and constrained INVOICE source identity. FinanceJournalLine adds partyId/invoiceLineId; ordinary journals cannot populate these or hit protected controls. FinanceReceivableEvent links one invoice to its exact journal/account/party/effective date/positive INVOICE amount. FinanceDeferredRevenueEvent links each positive deferred line to its BILLED journal/date/amount. Both are immutable. Commit-time checks prove source totals, GL and events agree; they are dated event history, not editable balances. Current future-recognition revenue mapping is frozen at billing.

Invoice numbering uses a private bounded NO CYCLE sequence, not count+1. Its gaps are intentional and voided numbers stay reserved. Runtime reads tables and calls only encova_finance_invoice_command. Common encova_finance_emit_journal and snapshot/usage helpers remain private. See [invoice design](../accounting/invoices.md) for exact source and deferred recognition boundaries.


## F13 receipt sources

FinanceCustomerDocument stores typed receipt headers, exact cash/fee/settlement values, dates, retained numbers, state/version and frozen posted party snapshot. FinanceCustomerAllocation links one receipt to positive allocations over 1–100 distinct invoices. FinanceJournalEntry adds a constrained unique customerDocumentId source. FinanceReceivableEvent adds typed negative RECEIPT events linked to the document; initial positive INVOICE matching remains separately checked. No authoritative mutable balance is stored.

Commit-time expected-line/event checks reject missing/extra/mismatched source effects and any negative dated invoice balance. Current active mapped bank/cash and ordinary expense accounts are rechecked at posting. Source/journal/events freeze after posting. The runtime can SELECT and call the checked customer command; private expected-line/emitter/capacity helpers and numbering sequence stay inaccessible. Ordinary ERP DTOs do not expose these relations.


## F14 client advance pools

FinanceCustomerDocument adds typed sourceDocumentId/advanceAccountId and exact advanceAmount. RECEIPT may issue a client-advance pool with unallocated/mixed cash; ADVANCE_APPLICATION references one original pool and one or more invoices. FinanceClientBalanceEvent binds each immutable signed event to its document, original source, party, liability account, journal and effective date. RECEIVED increases a pool; APPLIED reduces it. Expected GL/source/event and nonnegative dated balances are checked at commit. Pool usage never creates duplicate bank movement or revenue. Narrow SELECT/command privileges and Data API denial apply after runtime setup replay.

## F15 credit and correction schema

FinanceCustomerDocument adds constrained customer-credit/refund/internal-release/reversal kinds and creditInvoiceId, unique retained reversalOfId and unallocationOfId references. Original stored POSTED/version never rewrites; current REVERSED is derived. FinanceCustomerCreditLine stores one positive amount per original invoice line. FinanceCustomerCreditSplit is computed only inside posting and is immutable; its AR/held-balance amounts independently reconcile at commit. FinanceInvoiceCreditEvent is immutable dated signed credit eligibility history, distinct from financial AR and deferred events.

Existing AR, client-balance and deferred events gain only typed signed source kinds with source-retention FKs. The private expected-line/AR/fund/credit adapters and one shared emitter prove exact source/GL/event correspondence. Commit checks reject wrong paid/unpaid splits, extra/missing effects, over-credit, negative dated AR/funds/deferral, and source mutation. Private correction commands freeze contacts, retain original numbers, and create separate dated effects; generic journals stay blocked on controls. No JSON commercial catch-all or mutable balance authority is introduced.
