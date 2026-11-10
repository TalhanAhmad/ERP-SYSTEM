# Operational runbook

Encova is deployed at https://encova-workspace.vercel.app with Supabase PostgreSQL/Auth/Storage and Next.js frontend/backend on Vercel. Final source baf7d10 passed CI 42809226350, 324 automated checks and hosted acceptance. Seventeen migrations are applied. See deployment.md and tables-security-recovery.md for the current release, account-session cutover, TOTP setup and recovery limits. Company rollout is separate from this personal demo.

- Authentication problems: verify the auth URL matches browser origin; verify the domain Person is ACTIVE and linked; do not activate an arbitrary auth identity manually.
- Invitation/reset not delivered: run the worker, check SMTP availability, inspect Outbox attempts/nextAttemptAt/leaseUntil/deliveredAt. Never copy tokens or email bodies into logs or issue reports. Exhaustion occurs after five attempts; investigate before an audited retry feature is implemented.
- Stale-version errors: keep local input, reload the record and reconcile changes; do not silently overwrite.
- Attendance anomalies: compare immutable raw events, policy snapshot, approved leave and corrections. Run `pnpm reconcile:attendance YYYY-MM-DD` for a selected date. Approved corrections are preserved.
- Worker operation: `pnpm worker` is one pass. The protected daily Vercel scheduler is configured and a natural successful run is observed; monitor subsequent attempts. Mail acceptance followed by process failure can cause duplicate delivery after lease expiration; delivery is at least once.
- Deactivation: use the authorized service endpoint to revoke sessions and preserve work/history. At least one active super admin must remain.
- Secrets: `.env` and local databases are ignored. Rotate credentials through the actual host's secret store if exposed; never add them to progress documents.

## Company rollout gates

Verified employee sender/domain and dual-inbox email acceptance, owner authenticator/recovery setup and policy rollout, real policy confirmation, company hosting/pilot approval, and hosted database/Storage recovery remain owner-dependent. The local full logical restore drill passed; it is not provider PITR or object recovery. Follow planning/backlog.md for exact scope.

## Incident and rollback rehearsal

The prior protected deployment (source 5b44e83) was authenticated through Vercel CLI after migration seventeen. Its settings/projects services successfully read the upgraded database and its sign-out completed. The canonical alias was not changed and no database rollback was performed. Old immutable deployment URLs redirect unauthenticated visitors to Vercel SSO. If a real incident requires an application rollback, preserve the additive schema, identify the compatible deployment and repeat privileged-auth/security checks before restoring traffic; an older app may not enforce new security features. Never remove immutable history to repair an interface.

## Invitation controls and email state

People lists invitation status and email queue state for super admins; HR has no invitation-management UI/API in the owner-approved focused interface. Resend invalidates the prior link and grants a new 72-hour expiry. Revoke prevents acceptance, including an in-progress provider attempt. Used/revoked invitations cannot be resent. Concurrent management actions require the displayed version and a fresh deliberate action; retries with the same idempotency key do not rotate again.

Outbox now stores invitationId and canceledAt. Resend, revoke and acceptance cancel outstanding old mail. Workers skip canceled rows; a message already in flight can arrive, but its invalidated link cannot create an account. deliveredAt means SMTP server acceptance, not verified inbox receipt. Failed SMTP attempts remain queued for bounded retries. Do not expose outbox text, token hashes or provider IDs through browser lists/logs.

Without complete SMTP configuration the scheduled pass reports mailStatus=NOT_CONFIGURED or INVALID, claims no email and still reconciles attendance. Resend is now configured for owner-only demo email, and the daily attendance schedule is registered. Created/resent invitations get one scoped post-commit send attempt. Daily maintenance retries one permitted queued email; blocked recipients are skipped without consuming attempts. A verified domain is still required for staff mail. See [email operations](email.md) before real employee invitations.

Remote SMTP uses certificate verification and implicit TLS/required STARTTLS; transport behavior follows the [official Nodemailer SMTP guidance](https://nodemailer.com/smtp). Loopback fixtures remain local-only, and hosted settings reject localhost relays.
