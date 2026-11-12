# Architecture

Reuse Next Route Handlers/server components → finance services → shared access transaction → Prisma/PostgreSQL. Finance business queries stay server-only. Existing ERP identity/project IDs are reused without exposing financial relations in ordinary DTOs.

The foundation locks Person FOR SHARE to stabilize current status/role, then takes transaction advisory shared lock (629813, hashtext(Person ID)), then reads an active grant. Future grant mutations must lock Person first and take the exclusive advisory lock before updating grants. The protected callback runs before transaction release. A hash collision can conservatively serialize unrelated users; it cannot grant access. Operator SQL bypassing that protocol is outside the application boundary.

Grant rows remain SELECT-only to encova_app: PostgreSQL row locking would require UPDATE privilege. Transaction advisory locks avoid widening grant-write privileges. See PostgreSQL's [privileges](https://www.postgresql.org/docs/17/ddl-priv.html) and [explicit locking](https://www.postgresql.org/docs/17/explicit-locking.html) documentation. F04 implements dedicated owner mutation endpoints using the shared grant locking boundary and administration lock.

FINANCE_ENABLED is server-only and false by default. No actor or grant result is persisted in a client/shared cache. Finance pages/API routes use private/no-store cache headers including denied responses. Infrastructure owners remain privileged.

The future ledger/posting/worker architecture is in [editable Mermaid source](system.mmd); arrows beyond access are planned, not implemented.

F04 adds owner-checked access commands and operator-only setup/recovery, with shared administration locking and provider-verified process-local proof. See [ownership operations](../operations/ownership.md) for the exact trust boundary, lock order and recovery procedure.
