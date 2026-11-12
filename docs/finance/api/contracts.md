# Implemented API

GET /api/v1/finance/status is the only implemented finance endpoint. When finance is disabled it returns 404 without querying finance tables. When enabled it requires the existing verified application session (401 if absent), current ACTIVE SUPER_ADMIN and explicit active grant (403 otherwise), plus the shared DB rate limiter (429). Success is 200 with {data:{currency:"PKR",stage:"ACCESS_FOUNDATION"}}. It is not an accounting health/readiness check.

Responses, including errors, use private, no-store, max-age=0. Errors follow the existing {error:{code,message,requestId}} envelope and never include grant IDs or financial data. No mutation, bootstrap, ownership or monetary endpoint exists yet. No arbitrary catch-all financial actions were added.

The [OpenAPI document](openapi.yaml) describes only implemented behavior. Future endpoint groups are requirements in the supplied specification, not working API paths. Mutations will use CSRF/origin, strict schemas, expectedVersion and restricted permanent idempotency as implemented with each feature.

## F04 concrete operations

GET /api/v1/finance/access returns the authorized current owner/control snapshot, eligible administrators only for the current owner, the caller's or owner's grants/pending transfer, and recent restricted history. It is not a general finance register or public picker.

POST /api/v1/finance/access/grants: targetId, expectedVersion (settings), reason, reauth.
POST /api/v1/finance/access/grants/{id}/revoke: expectedVersion (settings), grantVersion, reason, reauth.
POST /api/v1/finance/ownership-transfers: targetId (already selected eligible admin), expectedVersion (settings), reason, reauth.
POST /api/v1/finance/ownership-transfers/{id}/accept or /cancel: expectedVersion (transfer), reason, reauth.

reauth contains password and, for Supabase, code (a fresh six-digit TOTP). It is never part of a receipt hash/result/audit. Bodies reject actor/owner/session/provider/verified-time overrides and unknown fields. Mutations require canonical Origin, X-Encova-CSRF: 1, application/json and Idempotency-Key (8–128 chars), plus the verified session and a shared six-per-minute actor limit. Grant/transfer return 201 (including successful replay), other actions 200. Errors retain private/no-store: 400 missing request key, 401 absent session, 403 role/grant/owner/reauth/MFA denial, 404 disabled/unavailable record, 409 version/state/owner-protection/key conflict, 422 invalid values, 429 limit. No bootstrap/recovery HTTP paths are exposed.

The returned version in every successful access-action result is the FinanceSettings version at that action’s commit. The expectedVersion input on accept/cancel refers instead to the transfer row version. Credential forms are disabled before hydration and use POST fallback; no credentials are placed in query parameters or retry state.
