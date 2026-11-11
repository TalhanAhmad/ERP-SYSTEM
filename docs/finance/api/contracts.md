# Implemented API

GET /api/v1/finance/status is the only implemented finance endpoint. When finance is disabled it returns 404 without querying finance tables. When enabled it requires the existing verified application session (401 if absent), current ACTIVE SUPER_ADMIN and explicit active grant (403 otherwise), plus the shared DB rate limiter (429). Success is 200 with {data:{currency:"PKR",stage:"ACCESS_FOUNDATION"}}. It is not an accounting health/readiness check.

Responses, including errors, use private, no-store, max-age=0. Errors follow the existing {error:{code,message,requestId}} envelope and never include grant IDs or financial data. No mutation, bootstrap, ownership or monetary endpoint exists yet. No arbitrary catch-all financial actions were added.

The [OpenAPI document](openapi.yaml) describes only implemented behavior. Future endpoint groups are requirements in the supplied specification, not working API paths. Mutations will use CSRF/origin, strict schemas, expectedVersion and restricted permanent idempotency as implemented with each feature.
