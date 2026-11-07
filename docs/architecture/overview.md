# Architecture target

Browser → Next.js Server Components or /api/v1 Route Handlers → verified context → feature services → Prisma/PostgreSQL. Scheduled Node worker shares the services and processes durable database jobs and email outbox.

Server Components read through authorized services directly. Route Handlers validate strict inputs, origin/CSRF, session, limits and idempotency before mutation. DTOs allowlist response fields. No secrets or raw auth records reach clients.

This describes the target, not an assertion that these layers already exist.
