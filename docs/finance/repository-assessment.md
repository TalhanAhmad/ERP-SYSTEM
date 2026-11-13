# F01 repository assessment

Assessed 11 November 2026, starting from clean commit 5fa1f87. The latest deployed application source before finance was fcb7bc7; intervening commits recorded confirmed company rules. The source is a working ERP, not the approximately 20% completion estimate mentioned in the supplied finance document.

| Area | Repository evidence | Finance gap |
| --- | --- | --- |
| Stack | Next 16.4.5, React 19.3.1, TypeScript 5.9.3, Prisma 7.10.1, PostgreSQL, Supabase Auth/Storage | Reuse; no framework replacement required |
| Identity | Verified provider session, ACTIVE Person, registered AppSession, current role and optional MFA | Explicit finance grants, owner lifecycle, mandatory fresh MFA for high-risk finance actions |
| Existing ERP | Tasks/reviews, projects, employees/teams, attendance, leave, reports, tables, jobs | Preserve all scopes and HR's four-menu interface |
| Persistence | 17 migrations and 47 public ERP tables before this work | No ledger, accounts, periods, documents, allocations, assets or finance grants existed |
| Verification baseline | Recorded 131 unit + 179 integration + 21 browser = 331 checks; last deployed source CI 42976770350 passed | Add accounting, isolation, concurrency and report acceptance, rather than treating old tests as finance evidence |
| HTTP | Shared verified context, origin/CSRF checks, body cap, DB rate limiter, safe errors | Concrete finance routes, private/no-store responses, restricted receipts/audit |
| Files/jobs | Private ERP objects and outbox/leases/retries | Finance quarantine/scanner, strict authenticated proxy, revocation at execution/download |
| Mutations | Generic ERP transaction wrapper caches receipts and generic audit | Do not put monetary payloads or finance receipts in ordinary Audit/Idempotency |
| Infrastructure | Vercel personal demo and Supabase are live | Finance staging, controlled migrations/runtime privileges, restore proof and separate launch decision |

Dependencies are installed and a separate loopback encova_test database is available. No START_HERE.md or companion documentation ZIP was supplied/found; the attached DOCX and repository instructions are the available source. No hidden pack is presumed implemented.

The existing provider supports TOTP, but the owner's device enrollment is not confirmed. Current optional ERP MFA policy must not silently become a claimed finance step-up implementation. No public bootstrap endpoint or first-admin auto-grant is acceptable.

## Estimate after inspection

The supplied baseline is 48 four-hour milestones (192 focused engineering hours). Retain the 48 acceptance groups, but use an initial allowance of **240–320 focused hours** (60–80 four-hour sessions), excluding waiting for accounting review, domain/scanner/provider setup and human acceptance. This is a planning range, not a delivery promise or booked effort. Reuse reduces identity/ERP work; immutable posting, dated settlement/reporting, restricted ownership, concurrency and recovery need substantial new implementation and evidence. Re-estimate at F08 after the first real posting fixture. Calendar dates and actual work are recorded; no pretend 48-day history is generated.

## Learning note

A role says which kind of administrator a person is; a finance grant selects which active administrators may access private books. Cash received is not automatically earned revenue. Existing ERP test success cannot establish accounting correctness. Human learning/sign-off has not been assessed.


## Finance F11 — 13 November 2026

F11 earned/deferred invoice backend is locally accepted: typed exact sources, private versioned API, shared emitter, immutable dated AR/BILLED events and posted client snapshots. Full regression passed207 unit +299 PostgreSQL integration +29 Chromium tests (**535**), strict typing/lint and local build. Final hosted-mode build, report validation and exact-source CI publication are in [F11 verification](testing/F11-results.md). F12 remains invoice editor/preview/private printable document. Test schema28 migrations; no hosted finance migration/grant/enablement, real financial seed or deployment. Original ERP learning acceptance remains separate.
