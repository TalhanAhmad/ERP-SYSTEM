# Implemented finance schema

FinanceGrant: UUID id and Person user/issuer/revoker references (ON DELETE RESTRICT), grant/revocation timestamps, bounded reason, positive version. A PostgreSQL partial unique index permits only one unrevoked grant per person; revocation actor/time must be paired and not precede grant time. Revoked history can be retained alongside a subsequent grant.

FinanceAuditEvent: UUID id, restricted Person actor reference, action, entity type/id, reason, JSON data, request UUID and timestamp. UPDATE/DELETE are rejected by a database trigger. Append writes are not routed into ordinary ERP Audit. Validated service payload schemas will accompany actual owner/posting operations; this table is not an arbitrary finance API.

Both tables have RLS enabled, no anon/authenticated grants and restricted encova_app grants. Runtime: SELECT FinanceGrant; SELECT/INSERT FinanceAuditEvent. The migration seeds zero rows. Owner/settings/ledger/subledger tables are pending, not flattened into JSON placeholders. The FinanceGrant partial uniqueness constraint lives in reviewed SQL because Prisma schema syntax does not represent it.

## F04 control schema

FinanceSettings is a UUID singleton with PKR CHECK, current owner Person, owner grant (including a composite FK to the same Person), positive version and server timestamps. FinanceOwnershipTransfer references current/target Persons, has a 24-hour expiry, constrained state/acceptance metadata, version and one pending-transfer partial unique index. FinanceAccessReceipt has a unique actor/operation/key, server-computed canonical JSON SHA-256 request hash, canonical result and immutable history trigger; no credentials are stored.

Database triggers block owner deletion/demotion/deactivation/grant removal and validate owner eligibility and an active matching grant. Selected accounts' email/provider bindings are protected; only the existing verified self-email synchronization can set a transaction-local self-service marker for email (never replacement provider IDs). Runtime reads control tables and invokes the dedicated owner-checked command; it cannot invoke operator setup/recovery. These are control records, not an accounting ledger or monetary source.
