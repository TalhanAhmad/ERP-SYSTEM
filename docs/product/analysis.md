# Specification analysis — 7 November 2026

## Request and document instructions

Talha requested analysis, implementation, verification, a recorded progress document, and a commit/push to https://github.com/TalhanAhmad/ERP-SYSTEM.git. This explicitly authorizes the Git push. It does not authorize production deployment or real employee-data migration.

The attachment proposes 60 four-hour sessions, daily advancement approval, and a learner explanation. These are document instructions, distinct from the user's direct request. Talha explicitly approved building across milestones, overriding the proposed daily advancement gate. Learning completion remains unclaimed.

## Baseline evidence

The supplied workspace was empty and had no .git directory or existing application. git ls-remote returned successfully without refs for the supplied remote. No previous implementation or instructions were available in the workspace. Node, pnpm, PostgreSQL, Docker, and gh were absent from PATH. Git author name/email are unset. An isolated Node installation is being prepared; no system package manager settings are changed.

## Product boundary

One company, approximately 100 synthetic users for initial testing; Asia/Karachi work dates and UTC event instants. Modular Next.js/TypeScript monolith with PostgreSQL, Prisma, Better Auth, Zod, durable jobs and SMTP. No payroll, billing, recruitment, chat, biometrics, file uploads, arbitrary spreadsheet formulas, public signup or multi-tenant platform.

## Delivery workstreams

1. Foundation: supported compatible dependencies, reproducible lockfile, setup and executable checks.
2. Identity: library sessions, invitation-only provisioning, reset emails, active linked users, privileged MFA and last-admin protection.
3. Organization: scoped people, teams/departments, manager-cycle prevention and deactivation.
4. Work: membership-scoped projects, assignments using stable IDs, immutable revisions and independent reviews.
5. Reports: one daily draft, immutable submissions, lead review, missing-report cutoff rules.
6. Attendance: effective schedules, snapshots, immutable raw check events, idempotency, date locks, finalizer and corrections.
7. Leave: full working days, overlapping reservations and attendance/approval concurrency protection.
8. Internships: independent mentors, milestones linked to approved work, weekly feedback.
9. Shared operations: notifications/outbox, worker leases, audit, saved table views, transactional bulk/import and safe exports.
10. Release: direct API security tests, real PostgreSQL integration, browser journeys, accessibility, representative performance, CI, backup/restore and approved pilot.

## Highest-risk requirements

- Authentication identity alone must never grant application access; active domain membership must be checked on every server entry.
- Permissions apply before list counts, filters, pagination, autocomplete and exports, as well as individual records.
- Self-approval is forbidden even for super admins; a lone administrator's own request remains pending.
- Leave approval and attendance must acquire the same date locks; unlocked read-then-write logic is insufficient.
- Expected versions and idempotency keys solve different problems; both need atomic persistence and concurrent tests.
- Approved corrections must survive reconciliation; raw check events stay immutable.
- Jobs require durable leases/retries and deduplication; a running page does not prove automation is healthy.
- No production-readiness claim without the complete acceptance journey and restore evidence.

## Unconfirmed business policy

Actual headcount, workweek, holidays, schedule/grace/buffer, report cutoff, retention, SMTP delivery and deployment host. Demo policy values require confirmation before pilot. No fabricated policies or employee records will be treated as company decisions.

## Acceptance evidence

Each feature requires frontend, backend service, executable migration, permission enforcement, error handling, meaningful tests and documentation. Unit tests cannot prove database locking, browser behavior or backup recovery. Those gates must be recorded separately.
