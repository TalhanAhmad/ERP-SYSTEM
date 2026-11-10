# Supabase + Vercel deployment and cutover

Current release (10 November 2026): source baf7d10, CI 42809226350, seventeen migrations, deployment dpl_9d8mcA3q8ei1LsPNMqahrFAB4mcA READY on the canonical domain. TOTP capability is enabled; global app policy stays off. Older foundation/milestone notes below are historical; current acceptance and external gates are in testing/results.md and planning/backlog.md.

Status (8 November 2026): personal testing demo deployed at https://encova-workspace.vercel.app. Official CLI browser authentication succeeded after connected project tools remained unavailable. Encova Solutions is a separate Supabase organization; Encova Workspace Demo runs in ap-south-1 (Mumbai). The Vercel encova-workspace project uses Hobby, Node 24 and bom1 functions. Ten hosted migrations and the real runtime preflight passed. Company production acceptance remains outstanding; no billing upgrade or real employee data migration was performed.

## 1. Provision isolated hosted resources

Create the Encova Supabase production project in the intended organization/region and a Vercel Next.js project for this GitHub repository. Confirm the account plan, budget, database region, function region and scheduler capability before choosing paid features. Separate Preview/Test and Production resources and environment secrets; previews must not write production employee records.

A new project normally requires account/organization access and the project's own credentials. Never paste secret keys, database passwords, service keys or cron credentials into chat or progress files. Set them through connected provider tools or the host's secret settings once authenticated project tools are available.

## 2. Migrate through a controlled connection

Configure DIRECT_URL only in the controlled migration environment, using the Supabase direct connection or session pooler on port 5432. DATABASE_URL for Vercel uses the restricted runtime user's transaction pooler on port 6543. URL-encode passwords. Copy connection details from the specific project's Connect dialog, not an example hostname.

Run pnpm db:generate and pnpm db:migrate:deploy with controlled credentials. The command refuses a hosted migration without DIRECT_URL and refuses the transaction pooler as the migration target. Apply supabase/setup.sql as the migration owner, set the encova_app password privately, then use that restricted login for the runtime DSN. Apply this setup again after migrations introducing new tables, and verify RLS/grants.

Never use prisma db push or reset against the production project. Existing migration history is retained, including immutable-history and concurrency constraints. Do not edit migration history to switch providers. Prisma does not manage Supabase's auth or storage schemas.

## 3. Configure Supabase Auth

Disable public sign-up and unwanted providers. Set the Site URL and an exact approved reset callback URL such as https://your-host/auth/confirm. Configure company SMTP and password policy. The backend reset request uses PKCE redirects; email templates may alternatively target /auth/confirm?token_hash={{ .TokenHash }}&type=recovery&next=/reset-password. Never permit arbitrary external callback destinations.

Configure privileged MFA and recovery before real staff data. The current provider adapter verifies identity and active domain membership but does not complete the full privileged MFA rollout or provider-wide revocation workflow. Domain deactivation denies application access immediately even while a provider access token has time remaining; hosted session-ban/revocation behavior still requires explicit acceptance work.

## 4. Set Vercel server environment

Required: AUTH_PROVIDER=supabase, APP_URL (exact HTTPS browser origin), DATABASE_URL (restricted pooled runtime DSN), SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, SUPABASE_SECRET_KEY, CRON_SECRET. SMTP_HOST, SMTP_PORT, SMTP_FROM and optional SMTP_USER/SMTP_PASSWORD are needed for the app invitation outbox. Optional DATABASE_POOL_MAX defaults to 2. DATABASE_SSL_CA accepts the provider trusted PEM root certificate when the Node trust store lacks it; certificate and hostname verification remain enabled. The configured CA must be obtained from the provider, never an arbitrary connection error. SUPABASE_STORAGE_BUCKET defaults to encova-private.

Do not set Supabase server secrets under NEXT_PUBLIC_ names. This implementation uses server endpoints and HTTP-only SSR cookies; no browser SDK key is required. DIRECT_URL is for migration CI/operations, not necessary for runtime functions. Configure APP_URL separately for Preview and Production and allow only intended callback URLs in the corresponding Supabase project. The deployment guard refuses legacy auth on hosted environments.

Vercel uses vercel.json and pnpm build:vercel, which generates Prisma Client before building Next.js. Migrations are a controlled release step, not a side effect of every preview build. Node 24 is already selected in package.json. Do not select static export or an Edge runtime for Prisma routes.

## 5. Provision the first production administrator

Keep the local Better Auth account local. In the Supabase environment, use pnpm bootstrap:supabase-admin with ADMIN_EMAIL, ADMIN_USERNAME, ADMIN_NAME, a newly chosen ADMIN_PASSWORD (8+ chars for the personal demo) and ADMIN_EMAIL_OWNERSHIP_VERIFIED=yes supplied privately. The operator must independently verify email ownership. The command can explicitly link an existing active super admin while preserving its domain UUID; it never automatically links arbitrary existing provider identities by email.

No bulk migration of real employee identities/passwords is authorized or performed by this change. If production legacy users exist, create and review an identity cutover/reset plan before changing AUTH_PROVIDER. Supabase and Better Auth sessions/password records are not interchangeable. During an incomplete cutover, unlinked identities remain denied.

## 6. Schedule and monitor jobs

The personal demo now configures a daily authenticated /api/internal/jobs invocation in vercel.json (15 0 * * * UTC). For higher throughput, configure an approved scheduler compatible with the selected plan. Clock slices have been replaced with captured audiences and durable per-person checkpoints. Passes have a 35-second work budget and resume queued/interrupted work; failed work requires an operator retry. The daily endpoint sends no email. Confirm actual hosted throughput before onboarding many users. Requests require Authorization: Bearer <CRON_SECRET>. Vercel Cron Jobs send this automatically when configured; newer Schedules may require the target's header configuration. The secret is never a URL query parameter.

The route is bounded to a 60-second Node function and uses durable email leases/date locks. Talha authorized a Hobby personal demo; the configured schedule remains daily, with no billing upgrade. An endpoint existing is not evidence that a scheduler is running. Monitor exhausted attempts, stuck leases, scheduler delivery and attendance completion; job-run dashboards/reminders remain backlog items.

## 7. Verify before pilot

Run pnpm verify:deployment with the actual hosted runtime configuration. It verifies disabled public signup, a restricted database role, enabled RLS, a private bucket and a TLS database connection. It fails without the configured project; it is not a substitute for browser or restore checks.

Then demonstrate live invite/login/logout/reset, active/unlinked/inactive users, attendance/leave races, task assignment/review and permissions with synthetic users. Repeat the implemented file workflow checks for the selected deployment; current synthetic acceptance covers size/type, upload/download scope, history and deactivation (see files.md). Record provider SMTP acceptance, recurring job invocations, privileged MFA, connection-pool behavior, backup restore into a separate database and rollback compatibility. Production readiness remains unclaimed until these pass.

## Current demo operations

Canonical URL: https://encova-workspace.vercel.app. Vercel hosts both the frontend and Next.js backend routes; Supabase hosts PostgreSQL, Auth and private storage. Preview deployments have no production environment secrets and are not yet a separate functioning test environment. Publish manually with the authenticated Vercel CLI after checks; Git auto-deployment has not been configured.

Resend application SMTP settings are provisioned for the restricted owner-only test sender; the release and live owner reset inbox delivery are verified. See [email operations](email.md). The daily attendance cron is now registered/enabled; its first natural invocation remains pending observation. Employee invitation delivery requires a verified domain; an unattended mail retry worker remains incomplete. See [monitored jobs](jobs.md) for exact scope and recovery. Bounded private file upload/download is implemented and live-verified; see [file operations](files.md) for the 4 MiB cap, permissions and retention/recovery limits. Privileged MFA, full employee reset inbox delivery, independent backup restore and company policy acceptance remain before staff production use.

The operator-only credentials and one-time admin password are kept under ignored .local/deploy with restricted file permissions; none belong in Git or public report exports. The runtime uses encova_app through port 6543; migrations use controlled session pooling on 5432. The seventh additive migration provides invitation versions and outbox cancellation/link metadata without changing existing bearer tokens during migration. The preflight verifies the actual PostgreSQL client's encrypted, certificate-authorized socket, because Supavisor's internal backend connection has different TLS state.

The eighth migration creates protected Attachment metadata with RLS/restricted-role grants and immutable revision enforcement. The deployed app proxies binary transfers through its authorized Node handlers; browser clients receive no storage key or signed URL. No storage or authentication credentials were added to preview environment variables.

The ninth migration adds protected JobRun/JobAttempt history and immutable audience/cursor rules. Operations supports super-admin dated queue/run/retry controls and safe queue counts. Schedule registration and protected manual execution are verified; the first natural timed invocation is separately pending.

The tenth migration adds one protected shared announcement slot. The focused HR interface and announcement TTL/cleanup are documented in [HR and announcement operations](announcements-hr.md). Source 5155215 passed CI 42487129069; deployment dpl_FVM6CY46egk1cz1c9pWgG5F3vvUK passed 21 targeted hosted checks.

Super Admin account-management source d7fd89d is deployed as dpl_14WHhC1sBzQ9JnYovXcnK9ewagNW, with successful CI 42515443745 and 22 hosted checks. It uses the existing ten migrations. See [People management](people-management.md) for role/status/session behavior and retained-work limits.
