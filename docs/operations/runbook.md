# Initial operational runbook

Production target is Supabase + Vercel; see deployment.md. Supabase session/provisioning adapters, restricted database setup and the serverless job endpoint are prepared. No deployment has been performed. Local startup and synthetic verification are documented in setup.md. This is not pilot sign-off.

- Authentication problems: verify the auth URL matches browser origin; verify the domain Person is ACTIVE and linked; do not activate an arbitrary auth identity manually.
- Invitation/reset not delivered: run the worker, check SMTP availability, inspect Outbox attempts/nextAttemptAt/leaseUntil/deliveredAt. Never copy tokens or email bodies into logs or issue reports. Exhaustion occurs after five attempts; investigate before an audited retry feature is implemented.
- Stale-version errors: keep local input, reload the record and reconcile changes; do not silently overwrite.
- Attendance anomalies: compare immutable raw events, policy snapshot, approved leave and corrections. Run `pnpm reconcile:attendance YYYY-MM-DD` for a selected date. Approved corrections are preserved.
- Worker operation: `pnpm worker` is one pass. Configure an external scheduler and monitor it before pilot. Mail acceptance followed by process failure can cause duplicate delivery after lease expiration; delivery is at least once.
- Deactivation: use the authorized service endpoint to revoke sessions and preserve work/history. At least one active super admin must remain.
- Secrets: `.env` and local databases are ignored. Rotate credentials through the actual host's secret store if exposed; never add them to progress documents.

## Release gates still open

Real SMTP journey, privileged MFA, shared operational job-run monitoring, full API/security/browser acceptance, least-privilege database credentials, deployment, backup restore into a separate database, rollback compatibility and incident drills. Do not claim recovery from a successful backup command alone. The local embedded distribution does not include pg_dump/pg_restore; install PostgreSQL client tools or use the approved database provider before the restore drill.

## Invitation controls and email state

People lists invitation status and email queue state for super admins; HR sees/manages MEMBER invitations only. Resend invalidates the prior link and grants a new 72-hour expiry. Revoke prevents acceptance, including an in-progress provider attempt. Used/revoked invitations cannot be resent. Concurrent management actions require the displayed version and a fresh deliberate action; retries with the same idempotency key do not rotate again.

Outbox now stores invitationId and canceledAt. Resend, revoke and acceptance cancel outstanding old mail. Workers skip canceled rows; a message already in flight can arrive, but its invalidated link cannot create an account. deliveredAt means SMTP server acceptance, not verified inbox receipt. Failed SMTP attempts remain queued for bounded retries. Do not expose outbox text, token hashes or provider IDs through browser lists/logs.

Without complete SMTP configuration the scheduled pass reports mailStatus=NOT_CONFIGURED or INVALID, claims no email and still reconciles attendance. SMTP service and recurring scheduler are not yet configured for the personal demo. Configure a verified sender and credentials privately before testing internet delivery; do not enqueue real employee invites before that acceptance check.
