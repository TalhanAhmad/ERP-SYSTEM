# Finance F12–F15 delivery record

Started 13 November 2026 (Asia/Karachi). User explicitly requested completing through F15 and committing/pushing each milestone separately. This record and the full work log track actual implementation/checks; no learner/accountant approval or effort hours are invented.

## F12 — invoice screens and private PDF

Implemented register/filters/detail, editable invoice lines with exact independent BigInt preview, complete searchable client/project and typed account choices, create/edit/post/void using the existing fresh-auth/idempotency pipeline, frozen posted contact preview and authenticated posted PDF downloads. PDFKit uses bundled licensed Noto Sans and server file tracing; no public URL, email or credentials in a document. Draft PDFs are denied; financial access is held throughout generation. Long invoices paginate.

Initial 49 focused tests passed. Browser journey passed (3.7 seconds): uncertain create response retry creates one source, editing increments version, posting freezes evidence and downloads an actual PDF. 360px WCAG and overflow checks passed. Full backend regression passed 208 unit and 301 PostgreSQL integration tests; strict typing/lint and both local/Supabase-mode production builds passed. New F12 UI browser journey passed; final complete browser regression will be repeated through F15. No database migration needed for F12. Source is committed/pushed separately before F13.

## F13 — receipts and partial/multiple allocations

Typed receipt/allocation sources, private searchable registers/detail/editor, fresh-auth create/edit/post/void, exact cash-plus-fee settlement equation and dated immutable receivable events. Partial and multi-invoice settlements post cash/fee debits and invoice AR credits through the existing single private emitter. Invoice views show actual dated settlement history and remaining receivable. Retained archived invoice projects may settle.

Capacity checks reserve the balance at the candidate date and every later effective date, so a backdated receipt cannot consume a balance already settled later. Current selected access/session, strict input, versions, permanent keys, source/event/GL commit integrity and runtime-only checked commands remain enforced. No generic protected-control bypass.

Full local regression: 212 unit and 314 PostgreSQL integration tests passed, strict typing/lint and local build passed. New multi-invoice/explicit-fee browser journey passed (4.3 seconds), including 360px WCAG/overflow. Targeted accounting regression passed all70 checks. Supabase-mode production build also passed using synthetic configuration only. F12 source abf7c6ccc0492414aeb9db8635f8eab7ae9652f5 passed CI43407757976, including complete30 browser tests.

Additive migration29 creates empty typed receipt sources/allocations and extends the shared emitter. Initial real posting tests exposed a loop-record/SQL-alias collision and an attempted cash-master usedAt update; existing cash mappings already freeze through their GL account usedAt marker. Additive30/31 correct those functions, preserving all applied checksums/data. No invalid receipt committed, reset or hosted migration occurred. Test schema now31 migrations.

## F14 — client advances and later application

Pending.

## F15 — credits, refunds and settlement reversals

Pending.

## Release boundary

Finance remains disabled live. Test database only; no hosted migrations/grants, real financial seed, automatic client email, merge or launch. F16 onward and company/accountant acceptance remain outside this delivery. [Milestones](planning/milestones.md) · [Full progress](../progress.md).
