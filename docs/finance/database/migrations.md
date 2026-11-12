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
