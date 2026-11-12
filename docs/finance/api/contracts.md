# Implemented API

GET /api/v1/finance/status is the original capability endpoint; ownership and setup operations are listed below. When finance is disabled it returns 404 without querying finance tables. When enabled it requires the existing verified application session (401 if absent), current ACTIVE SUPER_ADMIN and explicit active grant (403 otherwise), plus the shared DB rate limiter (429). Success is 200 with {data:{currency:"PKR",stage:"ACCESS_FOUNDATION"}}. It is not an accounting health/readiness check.

Responses, including errors, use private, no-store, max-age=0. Errors follow the existing {error:{code,message,requestId}} envelope and never include grant IDs or financial data. No public bootstrap/recovery or monetary posting endpoint exists. No arbitrary catch-all financial actions were added.

The [OpenAPI document](openapi.yaml) describes only implemented behavior. Future endpoint groups are requirements in the supplied specification, not working API paths. Mutations will use CSRF/origin, strict schemas, expectedVersion and restricted permanent idempotency as implemented with each feature.

## F04 concrete operations

GET /api/v1/finance/access returns the authorized current owner/control snapshot, eligible administrators only for the current owner, the caller's or owner's grants/pending transfer, and recent restricted history. It is not a general finance register or public picker.

POST /api/v1/finance/access/grants: targetId, expectedVersion (settings), reason, reauth.
POST /api/v1/finance/access/grants/{id}/revoke: expectedVersion (settings), grantVersion, reason, reauth.
POST /api/v1/finance/ownership-transfers: targetId (already selected eligible admin), expectedVersion (settings), reason, reauth.
POST /api/v1/finance/ownership-transfers/{id}/accept or /cancel: expectedVersion (transfer), reason, reauth.

reauth contains password and, for Supabase, code (a fresh six-digit TOTP). It is never part of a receipt hash/result/audit. Bodies reject actor/owner/session/provider/verified-time overrides and unknown fields. Mutations require canonical Origin, X-Encova-CSRF: 1, application/json and Idempotency-Key (8–128 chars), plus the verified session and a shared six-per-minute actor limit. Grant/transfer return 201 (including successful replay), other actions 200. Errors retain private/no-store: 400 missing request key, 401 absent session, 403 role/grant/owner/reauth/MFA denial, 404 disabled/unavailable record, 409 version/state/owner-protection/key conflict, 422 invalid values, 429 limit. No bootstrap/recovery HTTP paths are exposed.

The returned version in every successful access-action result is the FinanceSettings version at that action’s commit. The expectedVersion input on accept/cancel refers instead to the transfer row version. Credential forms are disabled before hydration and use POST fallback; no credentials are placed in query parameters or retry state.

## F05 account and period setup

GET /api/v1/finance/accounts and /{id}; POST /accounts; PATCH /accounts/{id}; POST /accounts/{id}/archive and /reactivate. Account create/update takes code, name, type, normalSide, reportGroup, controlType, currency (PKR default), parentId (UUID/null default), explicit isPosting/isContra/isCashEquivalent, reason and reauth; update additionally expectedVersion. Create IDs are server generated; unknown fields, balances and client usage markers are rejected. Code trims/uppercases; SQL also validates cross-field mappings and hierarchy. Archive/reactivate takes only expectedVersion, reason and reauth.

GET /api/v1/finance/periods and /{id}; POST /periods; PATCH /periods/{id}; POST /periods/{id}/void. Period create/update takes name, startDate and endDate (real ISO dates, years 0001–9999 inclusive), reason and reauth; update also expectedVersion. Void takes expectedVersion/reason/reauth. No close/reopen/delete endpoint exists. Inclusive overlap, stale/used/state/parent/code/key conflicts return 409; invalid allowlisted values return 422.

All reads require current selected ACTIVE Super Admin; mutations require current owner and the same fresh-password/hosted-TOTP/origin/CSRF/Idempotency-Key/rate controls as F04. Create/replay returns 201, other actions/replays 200 with {data:{id,version}}. Replays recheck current ownership/session. Config versions refer to the target row (not FinanceSettings). Errors and success remain private/no-store with Vary: Cookie.

List query: q<=100, page>=1, pageSize 1–100/default25; accounts active=ACTIVE(default)/ARCHIVED/ALL and type=ALL(default)/allowed account type; periods state=ALL(default)/OPEN/CLOSED/VOID. Unknown query keys return 422; unauthorized callers are denied before query/ID validation. Fixed account code/id or period startDate-desc/id order. Count/items share a configuration read lock; excessive pages clamp to the last page. List DTO: items,total,pages,page,pageSize,filters,canManage; accounts also bounded active parent groups. Detail DTO: item,canManage,latest25 restricted history; accounts also groups and derived mappingLocked. No monetary balances are returned. Invalid page filters show a clear fallback/default-view message; API remains strict.

Exact PKR validators are internal shared functions, not a public amount-validation endpoint. Their input/output contracts are in [setup and money rules](../accounting/setup-and-money.md); posting is not yet implemented.

## F06–F10 concrete journal, options and master operations

GET/POST /api/v1/finance/journals; GET/PATCH /journals/{id}; POST /journals/{id}/post, /void and /reverse; POST /journals/void-drafts. Every mutation uses fresh password plus hosted fresh TOTP, current selected access, Origin/CSRF and permanent Idempotency-Key, with shared six/minute reauth limit. Create returns 201; others 200, canonical {data:{id,version,journalId}}. Batch adds items:[{id,version}], validates all unique 1–50 rows atomically and identifies a conflicted draft in a 409 FINANCE_BATCH_CONFLICT. No bulk posting/deletion.

Journal create/update: reference (1–80), description (1–1000), evidence (3–1000), real postingDate, PKR/default currency, 1–200 typed one-sided decimal-string lines with optional projectId, reason and reauth; update adds expectedVersion. Drafts may be unbalanced but totals remain within range. Post/void take expectedVersion/reason/reauth; reverse also postingDate in an open period on/after the original. Only DRAFT is editable/voidable. Post validates active ordinary accounts, open period, balanced totals, current access and no future Pakistan-time date. Protected controls are denied. Original and reversal are independent immutable dated entries; REVERSED is derived from the link.

Journal list allows q<=100, state ALL/DRAFT/POSTED/REVERSED/VOIDED, from/to, sort date_desc/date_asc/reference, page1–10000 and pageSize1–100/default25. Totals cover filtered original source lines, not reversal-adjusted financial statements. Detail returns item with canonical decimal-string draft/original/reversal lines, exact totals, restricted history and up to100 active project options for drafts. All errors/success private/no-store.

GET /api/v1/finance/account-options: kind=parent/journal/cash, q<=100, page1–10000, optional allowed type/group/exclude UUID. Returns current eligible {id,code,name} items, total/page/pages, 25/page and stable code/id. It supports complete paginated parent search without the F05 first-100 limitation.

GET/POST /api/v1/finance/parties and /cash-accounts; GET/PATCH /{resource}/{id}; POST /{resource}/{id}/archive or /reactivate. Reads are selected-only; setup mutations current-owner-only, with the same fresh-auth/CSRF/key/rate controls and canonical {id,version}. Party fields: name, legalName, kind CLIENT/SUPPLIER/BOTH/EMPLOYEE/OTHER, optional contactEmail/phone/address/userId, reason/reauth. Cash fields: name, BANK/CASH kind, unique glAccountId, PKR currency, optional four literal maskedReference digits, reason/reauth. Updates add expectedVersion. Full bank numbers, balances, role/auth/usage overrides and unknown fields are rejected. Used mappings/classifications freeze; names/contact details remain correctable. Archive retains identity/history; cash-before-GL ordering and valid GL on reactivation are enforced.

Master list: q, active ACTIVE/ARCHIVED/ALL, resource-appropriate kind, sort name/updated, bounded page/pageSize. Responses return items,total,pages,page,filters,canManage; detail returns item/history/canManage and cash mappingLocked. OpenAPI now covers all 29 implemented paths with concrete verbs, strict write fields and response contracts. No invoice/payment/GL-report API is falsely represented as implemented.
