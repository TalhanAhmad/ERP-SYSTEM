# Encova Finance F11 delivery report

Started 12 November; verification13 November 2026, Asia/Karachi. Talha requested continuing from merged main. F11 is earned/deferred invoice schema and posting services; F12 remains the invoice editor/preview/private printable document.

## Delivered

- Typed invoice/line sources with server-generated nonreused numbers, exact rounded gross/explicit discounts and PKR totals.
- Private versioned create/edit/post/void and bounded register/detail APIs; current selected access, fresh authentication, CSRF and permanent idempotency.
- One private emitter shared with manual journals. Earned credits revenue; unearned credits protected deferred revenue. Posting atomically links GL, dated AR/BILLED events, frozen posted contacts, usage, receipt and restricted history.
- Database immutability/source/balance/event guards and restricted runtime/Data API privileges. No cached monetary balance or automatic email.

## Step record

1. Created finance/invoices-f11 from verified merged main bd5548003fdcbe1fab96c9f6abf73ae8f4969859; retained live finance gate.
2. Reviewed current source/specification/dependencies and installed routing guidance; limited this milestone to backend/schema.
3. Added empty additive migration 28 and generated Prisma mappings. Applied only to encova_test, preserving all existing applied checksums/data.
4. Refactored manual/invoice emission through one private typed engine and added exact calculation/API contracts.
5. Ran initial22 unit plus27 existing manual-ledger checks; all 49 passed. First four actual invoice integration scenarios passed.
6. Expanded to 24 invoice integration cases covering arithmetic, typed postings, snapshots, races, rollback and actual runtime privileges. Corrected fixture-only mistakes; no safeguard weakened.
7. Full local regression passed 207 unit and 299 PostgreSQL integration tests, strict typing/lint and local build. All 29 Chromium cases passed (1.5 minutes, invoice API 2.3 seconds), total 535 distinct tests. Supabase-mode production build also passed with synthetic configuration only.
8. Updated design/schema/API/migration/decision/milestone/work-log records and generated full/focused Word reports. Commit/push, draft PR and exact-source CI evidence follows publication.

## Acceptance and remaining work

See [exact results](testing/F11-results.md), [invoice design](accounting/invoices.md) and [F11 record](planning/days/F11.md). F12 adds accessible invoice screens/previews/private printable document. F13 onward adds settlements, advances/credits/tax and other commercial workflows. Recognition/recurring jobs remain F42. No arbitrary deferred-control journal bypass is provided.

Finance engineering is locally 11/48 complete; 37 groups remain. The original60 learner demonstrations are separate and have no new sign-off. Company chart/year/cutover/tax/recognition/accountant acceptance and separate launch decision remain open. No hosted finance migration/grant/enablement, real financial import, password/MFA change, live deployment or automatic client email occurred.

[Download focused Word report](Encova_F11_Report.docx) · [Full progress Word report](../Encova_Progress_Report.docx) · [Finance progress](progress.md).
