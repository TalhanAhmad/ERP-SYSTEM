# Implemented folders

- src/modules/finance/access/policy.ts: shared authorization and minimal capability status.
- src/app/api/v1/finance/status/route.ts: concrete authenticated read endpoint.
- src/app/(workspace)/finance/page.tsx: selected-admin setup screen.
- prisma/migrations/20261111010000_finance_access_foundation: grants and restricted audit only.
- tests/integration/finance-access.test.ts: real PostgreSQL/session/HTTP boundary checks.

Accounting and feature folders will be created with their implementation; no empty service scaffolds stand in for working features.

F04 adds access/{schemas,reauth,service,http,owner-guard}.ts, components/access-panel.tsx, concrete grants/ownership-transfer routes, /finance/access, scripts/finance/setup-owner.ts, ownership migrations 19/20 and real-PostgreSQL/browser/provider-contract tests. F05 accounting setup is described below.

## F05 accounting setup

accounting/{catalog,schemas,money,service,http,page-data}.ts implements typed classification, exact amounts, shared authorized configuration reads/commands and private HTTP/page boundaries. components/finance-action-form.tsx extracts the existing F04 credential form for reuse; setup-forms.tsx and setup-navigation.tsx implement account/period forms and accessible history. Concrete API/page folders are finance/accounts and finance/periods with explicit [id]/state-action routes. Migrations 21–22 and finance-money/finance-setup unit/integration/browser tests accompany the implementation. A shared ledger engine is still F06, not a stub in these services.

## F06–F10 actual modules

ledger/{schemas,service,http}.ts owns ordinary journal validation, current-session atomic commands, canonical detail/register DTOs and strict private handlers. masters/{schemas,service,http}.ts owns party/cash setup and reads. accounting/options.ts implements eligible paginated choices. Concrete journals/account-options/parties/cash-accounts API/page routes call these shared services. Components finance-register/detail-drawer/money-cell/account-picker/journal-forms/master-forms/master-pages reuse FinanceActionForm. No separate server or authentication stack was introduced. Migrations23–27 and finance-ledger/finance-masters unit/integration/browser tests accompany each boundary.
