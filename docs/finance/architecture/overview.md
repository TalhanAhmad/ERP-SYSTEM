# Architecture

Reuse Next Route Handlers/server components → finance services → shared access transaction → Prisma/PostgreSQL. Finance business queries stay server-only. Existing ERP identity/project IDs are reused without exposing financial relations in ordinary DTOs.

The foundation locks Person FOR SHARE to stabilize current status/role, then takes transaction advisory shared lock (629813, hashtext(Person ID)), then reads an active grant. Future grant mutations must lock Person first and take the exclusive advisory lock before updating grants. The protected callback runs before transaction release. A hash collision can conservatively serialize unrelated users; it cannot grant access. Operator SQL bypassing that protocol is outside the application boundary.

Grant rows remain SELECT-only to encova_app: PostgreSQL row locking would require UPDATE privilege. Transaction advisory locks avoid widening grant-write privileges. See PostgreSQL's [privileges](https://www.postgresql.org/docs/17/ddl-priv.html) and [explicit locking](https://www.postgresql.org/docs/17/explicit-locking.html) documentation. F04 implements dedicated owner mutation endpoints using the shared grant locking boundary and administration lock.

FINANCE_ENABLED is server-only and false by default. No actor or grant result is persisted in a client/shared cache. Finance pages/API routes use private/no-store cache headers including denied responses. Infrastructure owners remain privileged.

The future ledger/posting/worker architecture is in [editable Mermaid source](system.mmd); arrows beyond access are planned, not implemented.

F04 adds owner-checked access commands and operator-only setup/recovery, with shared administration locking and provider-verified process-local proof. See [ownership operations](../operations/ownership.md) for the exact trust boundary, lock order and recovery procedure.

## Ledger core and setup now implemented

F06–F10 adds the real manual-journal adapter and shared PostgreSQL balance/source/immutability safeguards, permanent identities and master/register modules. See [ledger core](../accounting/ledger-core.md) for current locks, exact scope and re-estimate. All initial financial/config writers serialize on admin then structural lock before row locks. Future typed subledger adapters must extend that private engine and source/control checks atomically; they cannot bypass it with table CRUD. Reports/cash registers/subledger jobs shown beyond this boundary in the architecture diagram remain planned.

F11 extends that shared emitter with typed earned/deferred invoice sources and synchronous dated AR/BILLED events. It does not introduce a second ledger or put commercial fields into ordinary ERP DTOs. No email/asynchronous document job is queued; the existing email-only outbox is not a financial event transport. See [invoice design](../accounting/invoices.md).
