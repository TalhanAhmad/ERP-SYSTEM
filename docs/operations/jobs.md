# Monitored attendance jobs

This milestone adds durable attendance execution and a super-admin Operations page. Personal-demo scheduling is registered/enabled on Vercel Hobby. The first natural invocation remains pending; 13 Operations and 46 other live checks passed. Exact source/deployment/CI evidence is in [test results](../testing/results.md).

## Scheduling and scope

The deployment uses `15 0 * * *` UTC, nominally around 05:15 Asia/Karachi. Hobby cron timing has hourly precision. This time follows the latest supported day-shift end plus the maximum four-hour closing buffer. The daily job targets the previous company date; it does not make today's still-open attendance final.

The protected endpoint creates one scheduled job per target date and processes up to five pending/interrupted jobs within an approximately 35-second work budget. It resumes old queued work before newer work. Failed jobs require an explicit operator retry. Missed platform invocations are not automatically backfilled across arbitrary dates: queue a dated check in Operations. Vercel does not automatically retry failed cron invocations.

A job captures up to 1000 ACTIVE people with a schedule assignment effective for its chosen date. People without a schedule are excluded; a captured person deactivated before processing is skipped. The audience and work date cannot change after creation. The 100-person integration case verifies correctness locally, not a hosted production throughput baseline.

## Progress, claims and history

Each attempt has a two-minute claim. Each person's reconciliation and the cursor advance commit in the same transaction, preserving progress across crashes. Bounded partial passes return to QUEUED. A timeout remains RUNNING until its claim expires; Operations then shows INTERRUPTED. A new attempt marks the old claim ABANDONED and continues from the saved cursor.

Concurrent claims are rejected, stale workers cannot checkpoint over a replacement claim, and repeating one request key never starts a second attempt. Each deliberate resume/retry uses a new key and records its reason. Finished attempt history and successful jobs are immutable. Completed dated jobs are snapshots of processing at that time; queue a new dated job for a later reconciliation, rather than rewriting history.

The processor preserves raw attendance events and corrected days. It honors approved leave and existing policy snapshots. Created/changed daily records are audited alongside job creation, attempt requests and completion. Manual processing stops if its operator loses active super-admin access. Failure storage contains known safe codes, not exception messages, connection strings or email bodies.

## Access and operation

Only an active SUPER_ADMIN can read Operations, queue a dated reconciliation or run/resume an attempt. HR/member callers are denied. Same-origin/CSRF, request limits, expected versions and retry keys protect browser mutations. The page shows the latest 50 jobs and five attempts per job; all attempts remain retained in the database. Advanced filtering/pagination and automated alerts remain future work.

The scheduled endpoint requires the configured CRON_SECRET bearer header. It classifies an authenticated request with the configured x-vercel-cron-schedule header as CRON; plain authenticated/manual service calls are classified CLI/Service. The header is telemetry, not the authentication boundary. The Operations card records the last CRON attempt so a manual test is not presented as a natural scheduled invocation.

No recurring external email sending is enabled by this schedule. Queued/failed email counts and configuration state are visible without recipients, message bodies or invitation tokens. `pnpm worker` is an explicit controlled CLI action that can process one email when SMTP is configured, alongside attendance. Resend is configured for restricted personal-demo delivery. Created/resent invitations now get one targeted post-commit attempt; the daily schedule still never drains email. An unattended retry worker and verified domain remain incomplete. See [email operations](email.md).

`pnpm reconcile:attendance YYYY-MM-DD "Reason"` creates an audited CLI job and runs a bounded pass. Use Operations to resume any remaining work. CLI credentials must belong to the intended environment; migration-owner credentials do not belong in Vercel functions.

## Verification and limits

Test claims/concurrency, partial progress, rollback, duplicate requests, expired claims, operator revocation, safe error storage, corrected/raw-history preservation and direct API permissions. Confirm provider schedule registration after deployment; then observe its first natural scheduled invocation separately. Existing immutable audit/history records are not deleted to reset job status.

Full company acceptance still requires measured hosted throughput, monitoring/alerting, recovery drills, backup restore, real SMTP, privileged MFA and the remaining ERP requirements. No billing upgrade is performed.

Provider references: [Hobby cron limits](https://vercel.com/docs/schedules/cron-jobs/usage-and-pricing), [cron authentication/concurrency/error handling](https://vercel.com/docs/schedules/cron-jobs/manage-cron-jobs).

## Automatic processing observed — 10 November 2026

Vercel request records confirm GET /api/internal/jobs at 00:53:15.103 UTC, HTTP 200, user agent vercel-cron/1.0. The corresponding CRON attendance attempt and maintenance run both reached SUCCEEDED. This closes the earlier first-natural-invocation observation gate; it does not establish continuous monitoring or inbox delivery to unverified employee domains.
