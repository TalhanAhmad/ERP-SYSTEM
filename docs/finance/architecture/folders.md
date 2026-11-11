# Implemented folders

- src/modules/finance/access/policy.ts: shared authorization and minimal capability status.
- src/app/api/v1/finance/status/route.ts: concrete authenticated read endpoint.
- src/app/(workspace)/finance/page.tsx: selected-admin setup screen.
- prisma/migrations/20261111010000_finance_access_foundation: grants and restricted audit only.
- tests/integration/finance-access.test.ts: real PostgreSQL/session/HTTP boundary checks.

Accounting and feature folders will be created with their implementation; no empty service scaffolds stand in for working features.
