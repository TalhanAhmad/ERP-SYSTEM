# F11 verification

Started 12 November, verified 13 November 2026 (Asia/Karachi). Dedicated encova_test only. Repeated runs are not added to distinct counts. No effort hours asserted.

## Local verification

- 207 unit tests passed, including 22 invoice schema/exact-arithmetic cases.
- 299 PostgreSQL integration tests passed, including 24 dedicated invoice cases and all 275 existing integration checks.
- 29 Chromium browser tests passed in 1.5 minutes; new invoice API journey 2.3 seconds. Distinct total **535**.
- Strict TypeScript and ESLint passed without warnings.
- Local production build passed. Supabase-mode production build also passed using synthetic production configuration; no hosted database connection.
- Migration 28 applied successfully on first deploy; all previous checksums preserved, no reset. Fresh-chain CI evidence follows publication.

Commands: PATH=/tmp/encova-toolchain/bin:$PATH; pnpm db:generate; DATABASE_URL/DIRECT_URL=(dedicated encova_test) caffeinate -di pnpm db:migrate:deploy; caffeinate -di pnpm test:unit; caffeinate -di pnpm test:integration; pnpm typecheck; pnpm lint; DATABASE_URL=(dedicated encova_test) pnpm test:e2e:prepare; caffeinate -di pnpm build; PLAYWRIGHT_PORT=3100 caffeinate -di pnpm test:e2e. Hosted-mode build uses AUTH_PROVIDER=supabase and only synthetic production-shaped URLs/keys, never a hosted database connection.

## Accounting and access proof

An earned 300,000 invoice debits receivables and credits income. A deferred 50,000 invoice debits receivables and credits deferred revenue, with no income or cash movement. Mixed discounted rounded lines produce 250.02 gross less 0.02 discount = 250.00 net, with 200.00 earned and 50.00 deferred credits. One hundred individually rounded 0.005 lines total 1.00 and create 101 GL lines. Zero/free lines remain source evidence but omit journal credits; all-zero posting rolls back without receipt/audit/event side effects.

Immutable posted source/lines/GL/AR/BILLED events reject mutation; dated source/receivable correspondence is checked at commit even for an otherwise balanced raw journal. Frozen client contact evidence survives a current-master correction. Future recognition revenue mapping is marked used at billing. Explicit versioning, void-number retention, concurrent same-key replay, different-key posting, edit/post and period-void/post races are checked. Invalid current mappings, client archive, archived project and future/void-period posting roll back atomically. Direct generic receivable/deferred journal bypass is denied.

Unselected Super Admin, HR, Team Lead and Member are denied before finance reads/input validation. Current grant revocation is rechecked after proof issuance. Actual encova_app command execution posts successfully; direct writes, private emitter/contact helper and numbering sequence calls are denied. Data API anon/authenticated have neither table nor command access after setup.sql replay. No privileged operator capability is exposed as an HTTP route.

## Browser scope

The new F11 journey uses actual logged-in browser sessions and HTTP Route Handlers to create/post/replay a mixed invoice, verify exact journal/dated events, reject forged totals/stale version and deny Member access. Owner contact edit preserves the posted snapshot. This is API acceptance, not an invoice editor/PDF UI claim; F12 owns those screens.

## Resolved findings and limits

The first four targeted invoice scenarios passed. Expanded checks initially used fixture mistakes: obsolete master state action, null/duplicate manual references, missing Project manager/description and missing paired grant-revocation actor. Corrected fixture inputs and repeated the complete 299-case database suite successfully; no application assertion was relaxed. The shared emitter refactor retained all 27 existing manual-ledger cases. A pre-existing pg adapter concurrent-client deprecation warning is observed; tests pass and no new direct unawaited pg queries are introduced.

Taxes, receipt allocations, credit notes, recognition caps, full statements, file/PDF/email delivery and representative accountant/company acceptance remain later work. Finance stays disabled live; hosted ERP stays on 17 migrations. No real company financial seeds, grants, owner setup or migration/deployment occurred.

## Report and contract verification

Full/focused Word exports include 24/4 current source documents respectively; prior focused F06–F10 report remains separate. Full report retains two historical synthetic screenshots; F11 report has no invented invoice-screen image. Word ZIP/XML/relationships, configured-private-value scan, all 33 concrete OpenAPI paths/verbs/references and 108 roadmap files/local links are checked before push.

## Publication

[CI 43399849090](https://github.com/TalhanAhmad/ERP-SYSTEM/actions/runs/43399849090) passed on source d74828436b29026e3b76a3fceea27b81047cd0e6: all 28 additive migrations on fresh PostgreSQL, 207 unit + 299 PostgreSQL integration + 29 Chromium browser tests (**535**), strict typing/lint, local and Supabase-mode production builds and documentation. Source is pushed in [draft PR #2](https://github.com/TalhanAhmad/ERP-SYSTEM/pull/2) on finance/invoices-f11; no merge or hosted finance release was performed.

The final tracking commit updates documentation/Word evidence only. Word ZIP/XML/relationships, local links, 33 API paths and configured-private-value scan are repeated before push. Application/schema/test source is unchanged from the passing source above.
