# Local setup

Verified platform: macOS ARM64; Node 24.22.2; pnpm 12.18.0. Runtime dependencies are exact-pinned in package.json and pnpm-lock.yaml. Next.js 16.4.5, React 19.3.1, Better Auth 1.7.18 and Prisma 7.10.1 were resolved together. Prisma 8's npm-default release candidate was deliberately excluded because the Better Auth adapter documents it as unsupported. TypeScript is 5.9.3.

## Start a fresh checkout

1. Install Node 24 LTS and pnpm 12.18.0.
2. Run `pnpm install --frozen-lockfile` and `pnpm db:generate`.
3. Copy `.env.example` to `.env`. Generate a random auth secret (for example `openssl rand -base64 48`). Never commit `.env`.
4. Start PostgreSQL and Mailpit with `docker compose up -d`, or use the local helper below. Compose's example password is local-only; production credentials must be independently provisioned.
5. Set DATABASE_URL for the development database and BETTER_AUTH_URL for the actual browser origin. Match scheme/host/port exactly.
6. Run `pnpm db:migrate:deploy`.
7. Supply ADMIN_EMAIL, ADMIN_USERNAME, ADMIN_NAME and ADMIN_PASSWORD privately in your shell environment, then run `pnpm bootstrap:admin`. The password must contain at least 12 characters and is never printed. The operator must verify the first admin's email ownership. The command refuses a second bootstrap once an active super admin exists. It creates auth and domain records atomically.
8. Run `pnpm dev`. Sign in at http://localhost:3000/login.
9. Configure schedules through `/schedules` before attendance use. Do not assume example weekday/shift rules are company policy.
10. Run `pnpm worker` periodically to process the mail outbox and reconcile attendance. It is a single-pass command, not an installed scheduler.

Mailpit web UI: http://localhost:8025. The SMTP configuration is required for real invitation/reset delivery. Email transport delivery has not yet been demonstrated with a real SMTP server in this session.

## Local PostgreSQL without Docker

`pnpm db:local` starts PostgreSQL 17.9 on loopback port 55432 and creates encova_dev, encova_test and encova_restore. The helper uses `.local/postgres` (gitignored), contains only development credentials and is not a production service. Use DATABASE_URL `postgresql://encova:local_only@localhost:55432/encova_dev`. Stop it with Ctrl+C.

The initial shell lacked Node, pnpm, PostgreSQL, Docker, brew and gh. This session downloaded an official temporary Node runtime to `/tmp/encova-toolchain`. Its PATH was `export PATH=/tmp/encova-toolchain/bin:$PATH`. This path will not exist on a clean machine; install Node normally there.

## Verification sequence

Use only the dedicated synthetic encova_test database. Integration tests truncate synthetic domain tables; the URL guard refuses any other database name. Never point tests at development or production data.

```
pnpm db:generate
DATABASE_URL=postgresql://encova:local_only@localhost:55432/encova_test pnpm db:migrate:deploy
pnpm typecheck
pnpm lint
pnpm test:unit
pnpm test:integration
DATABASE_URL=postgresql://encova:local_only@localhost:55432/encova_test pnpm test:e2e:prepare
pnpm build
pnpm exec playwright install chromium
pnpm test:e2e
pnpm verify:docs
```

Set TEST_DATABASE_URL if using a different port/password. Its database name must remain encova_test. Run integration and browser phases sequentially: they share the test database. The browser tests start and stop a production-mode Next server on port 3000. Do not already run another server on that port.

## References checked

- https://nextjs.org/docs/app/getting-started/installation
- https://better-auth.com/docs/installation
- https://better-auth.com/docs/authentication/email-password
- https://better-auth.com/docs/adapters/prisma
- https://www.prisma.io/docs/orm/reference/system-requirements

The authoritative installed versions are in the lockfile. Package build-script approval is allowlisted in pnpm-workspace.yaml. Package-supplied agent skills were not adopted.
