# Development setup

Use the existing Node 24 / pnpm 12 toolchain and PostgreSQL. Generate the Prisma client and run the guarded migration command only against the dedicated local database. FINANCE_ENABLED defaults false; enabling it does not auto-grant access. Never put secrets or test passwords in finance docs.

The synthetic integration tests create their own selected admin/grant inside encova_test. No operational bootstrap command exists yet; do not manually insert a live grant as a substitute for F04. Talha selected his existing account as the intended owner; F04 must resolve its immutable Person ID and validate active SUPER_ADMIN under lock before controlled setup.

Run pnpm typecheck, pnpm lint, pnpm test:unit and pnpm test:integration, then the production build and sequential prepared browser suite. Never run integration resets concurrently with browser tests or point test tools at hosted databases.
