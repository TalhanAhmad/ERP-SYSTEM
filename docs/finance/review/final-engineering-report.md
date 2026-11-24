# Encova Finance final engineering report

Updated 21 November 2026, Asia/Karachi, for Talha Ahmad. Intended Finance Owner: zablerkhanahmad@gmail.com. This report records completed engineering, actual checks, publication and the remaining user decisions; it does not record company/accountant acceptance.

## Outcome and source

PR #8 merged into main on 21 November 2026 at 12:54:56 Asia/Karachi, merge 62128ee7a24e5d2926fbceaae63c1ea55a56aaad. Its final source a14bc0d43b59fc3ad52da8a084a08454c9497274 passed CI 44781169698 before merge. The merged main passed [fresh CI 44882423627](https://github.com/TalhanAhmad/ERP-SYSTEM/actions/runs/44882423627): migrations, TypeScript/lint, unit/PostgreSQL/browser suites, both production build modes and API/documentation checks. A complete git tree comparison confirms the merge contains exactly the verified PR files. The earlier local 1,218-test result remains recorded separately: 353 unit, 802 PostgreSQL, 63 Chromium. Historical failed runs/corrections remain retained.

Read-only Vercel inspection found the canonical workspace still points to READY production deployment dpl_2SSKGD2xS2jojkBuHhoqN6xjLCa4, created before this merge. Vercel returned no source commit metadata, so this is not proof of a deployment of merged main. Public checks: /login 200 with the sign-in form; anonymous /dashboard 307 to /login; anonymous /api/v1/finance/status 401 UNAUTHENTICATED. The 401 proves authentication is required, not the finance feature flag, schema, grants or readiness. No hosted migrations, deployment, environment changes, grants or financial activation were performed during this post-merge pass.

## What was completed

| Step | Delivered result | Separate source |
| --- | --- | --- |
| F41 | Reviewed original opening imports, typed subledger cutover, clearing proof and private originals | e758baa |
| F42 | Reviewed recurring drafts/attempt recovery, explicit deferred recognition/opposites and opening-credit input review | f62a4fa |
| F43 | Exact nine-source acceptance, fractional rounding/concurrent credits and distinct project cash/margin | 608ab0a |
| F44 | Full access/file/ERP regression plus independent schedule/readiness/source-review constraints | bb14c49 |
| F45 | Combined browser close/correction/revocation, lost-response idempotency and source workflow links | c097849 |
| F46 | Two populated restores, exact data/security/catalog checks, separately restored signed object and additive/faulted rollback | 85072d4 |
| F47 | User-selected accounting review workbook, policy/gap table and unfilled reviewer record | 703cc14 |
| CI correction | Matching PostgreSQL17 clients from existing service image; no unavailable apt package assumption | b8b2a1f |
| F48 | This final acceptance/release pack, final local regression and separate launch decision record | This report publication |

No previous applied SQL was rewritten. Four additive migrations81–84 extend the prior merged80. Financial source/GL/event history is retained; no history was deleted to make a check pass.

## Actual verification

Final local engineering acceptance passed 1,218 distinct tests:353 unit5.64s,802 actual PostgreSQL454.42s,63 Chromium4.7m. The complete browser run includes the new combined nine-source journey19.1s and lost committed-response recovery9.0s, ERP roles/HR/attendance/leave/assignments/announcements/invitations, private files/scanning/exports, mobile/keyboard/WCAG and retained correction/access boundaries. Both normal and Supabase-shaped production builds, strict TypeScript/lint,250 concrete API contracts and all84 applied source checksums pass.78 recovery-focused checks additionally passed25.35s after strengthening column/trigger/owner/grantor/index/RLS comparisons; they are included in the distinct full-suite count, not added again.

The fixed nine-source dataset reconciles1445000.00 debit/credit turnover,575000.00 bank,100000.00 AR,30000.00 AP,75000.00 loan,60000.00 equipment,50000.00 investment,180000.00 earned profit and785000.00 assets. Liabilities105000.00 plus equity680000.00 equal assets. Project contribution180000.00 differs from recorded project cash110000.00. Cash categories operating110000.00/investing-110000.00/financing575000.00 reconcile. These are synthetic examples, not company figures.

The browser journey matches all seven original cash legs, finalizes reconciliation, closes actual books, downloads a retained final PDF, rejects posting while closed without another journal, reopens through the owner, supersedes the old download, posts an evidenced0.01 correction, shows179999.99 current profit, creates a new ready export and denies it after grant revocation. Passwords clear on submission; committed-response loss retries the original key once with one schedule/no journals. Original saved reports remain unchanged.

Two local recovery scenarios compare all132 public tables plus column definitions/defaults/nullability, constraints, indexes/validity, triggers, functions/owners/grantors/execute privileges, schema/relation/default ACLs, RLS/policies, enums and sequence values. They preserve real PDF/CSV bytes, opening original text/hash, recognition and recurring attempts. The base scenario separately restores a signed original PDF evidence object and verifies its metadata hash. Populated source fingerprints stay unchanged; actual additive and faulted migration probes roll back. Hosted targets/unowned source directories are refused. Private dumps/objects stay ignored in0700/0600 artifacts.

## Failures resolved and limits

Retained the actual corrected attempts: fixture mapping/default/import/selector mistakes; strict authorization preceding validation; CHECK/default-ACL serialization normalization; wrong sequence ACL code; exact export format/report fields; CI's unavailable PostgreSQL17 apt package; and the existing two-order closing concurrency case exceeding its five-second default test budget on Linux. Only that case receives30seconds; production timeouts/assertions remain unchanged. New Linux restore scenarios passed58+18cases before that unrelated timeout. Focused/full reruns verify the corrections without weakening financial or permission assertions. Full work-log entries336–349 preserve details, including the earlier F41 transaction-wrapper rehearsal mistake and exact migration receipt reconciliation; it was not counted as a successful rollback.

Authorized engineering and review/release-pack preparation are complete. F47 actual company review/policy acceptance and F48 separate staging/live launch decision remain pending. Actual hosted finance migration/runtime-private permissions/scanner/Storage/provider restore verification, real fiscal/chart/tax/measurement/cutover choices, original opening reconciliation, live owner/grants/MFA and activation are not configured by these synthetic tests. Finance stays disabled. No real books or paid upgrade occurred.

## Review next

Read [review workbook](reviewer-workbook.md) and fill reviewer/date/company policies/gaps. Read [release decision](release-decision.md), [recovery evidence](recovery-evidence.md) and [deployment/rollback runbook](../operations/deployment.md). The current source/CI status is available in [progress](../progress.md) and PR8 checks. Only actual reviewed decisions and staging evidence can close the remaining human gates.

The full step-by-step history remains in [work log](../../work-log.md), [full Word report](../../Encova_Progress_Report.docx), [F26–F48 Word report](../Encova_F26-F48_Report.docx) and the individual milestone records. No effort hours or learner demonstrations were fabricated.


## Local review demo — 22 November 2026

Talha selected the isolated synthetic finance demo and then chose to keep it local after Supabase rejected a separate free project for account capacity. The persistent six-role local demo is delivered; [guide and actual verification](isolated-demo.md) record the link, private credential location, sample statements, start/stop commands and limits. No hosted finance activation, real books/policy acceptance or paid upgrade occurred. Human company review and any future hosted finance setup remain pending.


## Demo publication verified — 24 November 2026

[Draft PR #9](https://github.com/TalhanAhmad/ERP-SYSTEM/pull/9) contains pushed source 9ec43c74cbea94c80c4b4b38b41057be64db0204. [Fresh Linux CI45042106142](https://github.com/TalhanAhmad/ERP-SYSTEM/actions/runs/45042106142) passed all 1,227 distinct tests (358 unit, 806 PostgreSQL, 63 Chromium),84 fresh migrations,types/lint,both production builds and250 API/documentation contracts. All seven actual persistent-demo browser/security scenarios passed again on 24 November; its login returned200 and nine posted sample sources remain unchanged. No application/schema change was needed in this follow-up. PR9 remains unmerged; local-only scope and actual company-review/hosted-setup gates remain unchanged.
