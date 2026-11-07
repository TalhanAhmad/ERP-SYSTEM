# Implemented API surface

Implemented through the Next.js `/api/v1/[...path]` Route Handler, with explicit path dispatch. Unknown routes return 404. Authentication uses Better Auth's `/api/auth/[...all]`. Server pages call the same authorized services directly.

GET: /me, /projects, /tasks, /users?q=, /notifications, /audit (super admin), /dashboard, /attendance, /attendance/me, /leave, /corrections, /schedules (HR/admin), /reports.

POST: /projects, /projects/:id/members, /tasks, /tasks/:id/status, /tasks/:id/submissions, /submissions/:id/review, /invitations, /invitations/accept, /notifications/:id/read, /schedules, /schedule-assignments, /attendance/check-in, /attendance/check-out, /leave, /leave/:id/{approve,reject,cancel}, /corrections, /corrections/:id/{approve,reject}, /reports, /reports/:id/{submit,acknowledge,return}, /users/:id/role, /users/:id/deactivate.

PATCH: /reports/:id (own draft only).

All mutations require same-origin `Origin`, `X-Encova-CSRF: 1`, application/json and strict schemas. Authenticated domain mutations additionally require an Idempotency-Key (8–128 characters). Versioned decisions require expectedVersion. Attendance bodies are empty objects: user ID and event timestamps are server-controlled. Invitation acceptance is public but single-use token/email validated and database-rate-limited.

Write envelope: `{data: ...}`. Errors: `{error:{code,message,fields?,requestId}}`. JSON requests are streamed with a 256KB limit. Lists currently cap at 100 and do not yet implement the full specification's pagination metadata. Dashboard totals use scoped database counts rather than those capped arrays. No claim that the full proposed API contract or OpenAPI schemas exist yet.

Auth and domain records are separate. Every application entry resolves a live database session and an ACTIVE linked Person. Public sign-up is disabled. HR access does not grant report narratives or project membership. Exports/imports and unsupported resource mutations are not exposed.

## Provider-neutral account and automation endpoints

POST /api/session/sign-in, sign-out, password-reset, password-update use same-origin/CSRF validation and safe success DTOs. In Supabase mode they use the server SDK and HTTP-only SSR cookies. GET /auth/confirm exchanges supported recovery tokens/codes and redirects only to allowlisted internal routes. Legacy /api/auth is disabled in Supabase mode.

GET /api/internal/jobs is a machine-to-machine scheduler endpoint requiring the configured CRON_SECRET bearer value; it does not use browser cookies. It runs one bounded pass, not a permanent worker. No recurring schedule is enabled until the provider plan/configuration is verified.
