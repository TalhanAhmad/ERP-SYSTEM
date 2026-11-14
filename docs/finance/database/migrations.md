# Migrations

18th additive migration: 20261111010000_finance_access_foundation. Creates only FinanceGrant, FinanceAuditEvent, indexes/checks/retention FKs, audit immutability trigger and RLS/runtime privileges. No existing column/data rewrite or grant backfill.

Applied only to loopback encova_test for verification. Hosted Supabase remains on the original 17 migrations. No live migration/deployment is authorized merely by the supplied document. supabase/setup.sql now excludes Finance-prefixed tables from generic CRUD grants and explicitly reapplies the narrower access permissions; tests rehearse it twice.

Before a later rollout: rehearse clean migration/restore, inspect runtime privileges, back up separately, deploy behind a disabled feature gate and obtain a separate finance release decision. Prefer forward additive correction; never delete posted history as rollback.

## F04 migrations

19: 20261111020000_finance_ownership adds control tables, receipt immutability, owner/identity triggers and restricted functions/privileges. 20: 20261111030000_finance_access_input_validation adds strict expected-version and allowlisted-input validation to the access function without changing records. Migration 19's applied checksum is retained and tested. Both are applied only to the isolated test database; hosted Supabase remains on 17.

A proposed Prisma test-database reset was blocked before execution and abandoned. Migration 20 initially failed SQL CASE parsing; corrected it, marked only the failed migration attempt rolled back and successfully deployed the additive function replacement. No reset or dangerous-action consent override occurred. Test teardown removes only its owned synthetic singleton/mutable fixture grants/transfers; immutable audit/receipt history remains. Existing ERP records are preserved by that fixture cleanup.

## F05 migrations — 12 November 2026

21: 20261112010000_finance_accounts_periods adds empty account/period/setup-receipt tables, typed checks, inclusive GiST exclusion, hierarchy/usage/retention triggers, atomic owner-checked commands and narrow runtime/RLS privileges. 22: 20261112020000_finance_used_group_guard extends the account guard to freeze ancestor mapping when any descendant is used. It preserves migration 21 and all data. Neither adds company chart/fiscal-year/financial seeds or modifies the ERP tables.

Both were successfully applied only to encova_test by the guarded additive migration deploy command. No database reset was used. Fresh-runner application and test results are tracked in testing/results.md; no hosted migration is implied. supabase/setup.sql replay restores only config SELECT and command EXECUTE, never broad finance CRUD. Tests revoke then replay privileges and actually execute the command under encova_app.

## F06–F10 additive migrations — 12 November 2026

23 (20261112030000_finance_journal_engine): empty typed drafts/ledger/receipt tables, immutable/deferred guards and restricted atomic ledger command. Initial SQL CASE parse failed with no partial table; resolved only the failed record and corrected before successful deployment. No reset.

24 (20261112040000_finance_draft_guards): deferred saved-draft cardinality/range/source checks and immutable restricted revision snapshots. 25 (20261112050000_finance_parties_cash): empty party/cash mapping tables, retention/usage/GL-binding guards and owner-only master command. 26 (20261112060000_finance_snapshot_precision): keep audit line amounts as exact decimal strings. 27 (20261112070000_finance_batch_results): canonical updated batch versions and identified first-row conflict. Applied SQL checksums remain unchanged; all corrections are additive. All five migrations are explicitly transactional.

All 27 migrations are applied only to encova_test in local verification. No company chart, fiscal period, opening book or hosted grant/migration is seeded. Fresh-runner verification is recorded against the exact source in testing/F06-F10-results.md. supabase/setup.sql replays narrow SELECT/EXECUTE privileges without widening to generic CRUD.

## F11 additive invoice migration — 12–13 November 2026

28: 20261112080000_finance_invoice_core creates empty typed invoice/line/dated-AR/deferred-event tables and a private noncycling invoice-number sequence. Extends ledger source identity/party/line references and account control checks with DEFERRED_REVENUE. Refactors manual/invoice emission through one private function while preserving source/balance/immutability enforcement; adds checked invoice command, deferred source/event consistency, exact calculation, permanent receipt/audit and narrow runtime/RLS grants.

Applied successfully on its first deployment only to encova_test; no earlier applied checksum was edited, no reset, financial seed, live owner grant or hosted migration. Local test schema now has28 migrations; hosted ERP remains17. CI must apply the whole chain to a fresh isolated database before publication is accepted. supabase/setup.sql replay grants only invoice SELECT/checked-command EXECUTE and never sequence/private-emitter access.


## F13 — 13 November 2026

29 (20261113010000_finance_receipts) creates empty typed customer document/allocation sources, extends shared journal/dated AR source integrity and checked receipt commands, and reserves dated invoice capacity. 30 (20261113020000_finance_receipt_validation) removes a PL/pgSQL record/alias collision. 31 (20261113030000_finance_receipt_cash_usage) uses the existing GL usage marker rather than a nonexistent cash-master marker. Applied checksums are unchanged; no reset. All31 migrations apply only to encova_test; no live financial seed/grant/migration.


## F14 — 13 November 2026

32 (20261113040000_finance_client_advances) adds typed source-pool references, advance account/amount fields and immutable FinanceClientBalanceEvent, signed dated AR/application effects, private historical capacity and checked receipt/application commands. Initial DDL CASE parsing failed transactionally; corrected before successful application after isolated ROLLBACK validation and resolving only the failed attempt. Earlier applied migrations unchanged; no reset or hosted change.

## F15 — 13 November 2026

33 (20261113050000_finance_customer_credits_refunds) adds empty typed credit lines/posting splits/credit eligibility events, retained credit/correction/release references and stricter source-specific signed-event/check constraints. Existing shared engine/commands extend earned/deferred credits, refunds and dated opposite/released settlement effects. All new finance tables use RLS and runtime SELECT plus checked command only; private helpers/sequences/Data API writes remain denied after setup replay.

The whole DDL first passed an explicit ROLLBACK rehearsal, then its first guarded additive deployment to encova_test. No prior applied checksum edit/reset/hosted migration. Total33 migrations; exact fresh-runner evidence belongs to the final F15 source CI, not prior milestone runs.

## F16–F25 additive migrations

34 bills/immediate expenses;35–36 supplier cycle/credit split;37–43 reviewed source tax, withholding and permanent replay compatibility;44–47 private evidence/quarantine/signed scan/retention;48 cash transfers;49–50 founder funding and SQL alias correction;51 loan agreements/events;52 investment holdings/acquisition lots;53–54 explicit lot disposal/income/value movements, register-only retirement and basis/use guards;55 asset registration with source-GL cost-cap protection.

Each DDL addition was rehearsed with ROLLBACK and deployed only to encova_test. Applied successful checksums were retained; corrections use later additive migrations. No reset, hosted finance migration, real seed or owner grant is performed. Final source-specific checksum/fresh-runner results are recorded in the [delivery tracker](../delivery-F16-F25.md).

## F26 isolated lifecycle migrations

56 (20261114050000_finance_asset_lifecycle) introduces typed asset movements, immutable dated events, protected journal linkage, permanent asset/month identity, exact source/cached-position proof and the shared emitter adapter.57 (20261114051000_finance_asset_event_proof_fix) corrects a composite-row scalar proof and explicitly excludes contra gain/loss/fee mappings. Both passed transaction rollback rehearsal before guarded deployment to encova_test. Applied checksums are retained; no existing successful migration is rewritten. No hosted database change is part of this engineering milestone.

58 (20261114052000_finance_asset_policy_draft_review) distinguishes permanent monthly source identity from policy consumption: unposted future drafts do not prevent a revised prospective plan, and refresh updates their charge on the same identity. Posted monthly history remains protected. Rehearsal/apply/checksum checks passed on the isolated test database; no applied SQL was rewritten.
