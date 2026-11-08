# ADR-002: Supabase and Vercel production stack

Date: 2026-11-07 (Asia/Karachi)
Status: accepted; personal-demo hosted provisioning/cutover and bounded private file workflow verified. Company production acceptance remains incomplete.

## Decision

Use Next.js App Router, TypeScript and Tailwind CSS on Vercel. Keep backend Route Handlers and authorized feature services in the same application. Use Server Actions where they help a server form; do not duplicate working API workflows or introduce Express/NestJS. Keep Prisma for domain queries, transactions, UUID relationships, concurrency locks and migrations. Supabase hosts PostgreSQL, Supabase Auth manages production identities/sessions, and Supabase Storage is the selected private binary store.

This explicitly supersedes the original specification's production Better Auth choice. The original source DOCX remains preserved as historical requirements. Storage changes the earlier deferred-upload assumption, but choosing Storage does not implement an upload workflow; its completion/security tests remain a launch gate.

## Inspected baseline and reuse

The repository already has a working PostgreSQL/Prisma modular monolith with authorized services and real integration/browser checks. No separate backend is needed. Better Auth was implemented and a single local development administrator was created. No hosted Supabase/Vercel project or production employee-data migration was established.

The current transition preserves that local login under AUTH_PROVIDER=better-auth. This is compatibility for local development, not a second production choice. Vercel production and preview configuration reject legacy authentication and require Supabase. Changing the provider does not make local passwords or auth UUIDs portable; Supabase identities must be provisioned and explicitly linked. Domain Person UUIDs remain permanent.

## Database and access boundaries

DATABASE_URL is the restricted runtime connection through Supavisor transaction pooling. DIRECT_URL is used by controlled migration commands through direct/session connectivity. Migration credentials belong in the migration environment; they are not required in deployed function environment variables. The runtime pool is bounded per function instance.

All browser business-data access continues through authorized Next.js services. Supabase publishable-key users do not get direct access to application tables. supabase/setup.sql enables RLS, revokes anonymous/authenticated grants and creates a restricted encova_app server role/policies. This server policy does not apply per-user auth.uid filtering; the application enforces live row/role permissions before using its server database connection. The service secret never goes into browser bundles.

## Authentication and provisioning

Supabase SDK getUser verifies sessions before ACTIVE linked domain-user lookup. No client role metadata or unverified getSession result grants access. HTTP-only cookies are maintained by the Supabase SSR library through Next Route Handlers/Proxy; no browser Supabase client is required for these forms. Production public sign-up must be disabled at Supabase.

Supabase HTTP provisioning cannot share a Prisma transaction. A persisted invitation lease claims work, the provider call runs outside the transaction, then a second transaction links/activates the Person and consumes the invitation. Interrupted provider work is retried only through server-controlled invitation provenance. Unlinked/orphan identities cannot enter the workspace.

## Serverless jobs and storage

Vercel functions do not run the development worker permanently. /api/internal/jobs is a bounded Node endpoint protected by a random CRON_SECRET bearer value. Email leases and date locks persist in PostgreSQL. The job now processes captured active assigned audiences for a target date, committing each attendance update with its cursor. Bounded partial/expired work is resumable. The daily endpoint does not send mail; explicit CLI worker execution can process one queued email when configured. Recurring scheduler configuration, actual mail throughput and function duration must be verified against the chosen hosting plan. A daily personal-demo cron is now registered under the user's continuing implementation authorization. It uses durable captured audiences/checkpoints and sends no email; first natural invocation remains pending. See [job operations](../operations/jobs.md).

The setup SQL provisions a private encova-private bucket with a 10MB cap and a small MIME allowlist if the storage schema exists. There is no public bucket and no direct upload policy. Authenticated proxy upload/download, attachment records/UI and immutable revision acceptance tests are now implemented for files up to 4 MiB. No browser signed URLs are issued; current account/project access is rechecked per download. See [file operations](../operations/files.md) for limits and deferred larger/retention features.

## Alternatives and consequences

Keeping Better Auth for production was superseded by the user's chosen stack. Replacing Prisma with browser Supabase CRUD would require rewriting transactional services and permissions, so it was rejected. A separate backend would add deployment and session boundaries without a measured need.

No architecture can guarantee zero future changes. The intent is to retain the domain services while deployment-specific connection, session, storage and scheduling concerns are isolated. A successful local build or simulated SDK contract test does not prove live provider setup, MFA, real SMTP, file access or recovery.

## Sources checked

- https://supabase.com/docs/guides/database/prisma
- https://supabase.com/docs/guides/auth/server-side/nextjs
- https://supabase.com/docs/reference/javascript/auth-admin-createuser
- https://supabase.com/docs/guides/storage/security/access-control
- https://vercel.com/docs/cron-jobs/manage-cron-jobs
- Installed Next.js 16.4.5 route-handler, proxy, cookies and CSS documentation under node_modules/next/dist/docs/.
