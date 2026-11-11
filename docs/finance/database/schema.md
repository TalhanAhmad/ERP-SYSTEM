# Implemented finance schema

FinanceGrant: UUID id and Person user/issuer/revoker references (ON DELETE RESTRICT), grant/revocation timestamps, bounded reason, positive version. A PostgreSQL partial unique index permits only one unrevoked grant per person; revocation actor/time must be paired and not precede grant time. Revoked history can be retained alongside a subsequent grant.

FinanceAuditEvent: UUID id, restricted Person actor reference, action, entity type/id, reason, JSON data, request UUID and timestamp. UPDATE/DELETE are rejected by a database trigger. Append writes are not routed into ordinary ERP Audit. Validated service payload schemas will accompany actual owner/posting operations; this table is not an arbitrary finance API.

Both tables have RLS enabled, no anon/authenticated grants and restricted encova_app grants. Runtime: SELECT FinanceGrant; SELECT/INSERT FinanceAuditEvent. The migration seeds zero rows. Owner/settings/ledger/subledger tables are pending, not flattened into JSON placeholders. The FinanceGrant partial uniqueness constraint lives in reviewed SQL because Prisma schema syntax does not represent it.
