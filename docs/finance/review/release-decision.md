# F48 release decision record

Status: engineering release preparation is merged and verified; no live finance activation is established by the merge. This record provides a concrete review point, not permission to infer company policy or import books.

## Evidence to review

- [Finance progress](../progress.md), [verification results](../testing/F26-F48-results.md) and [milestone records](../planning/milestones.md) distinguish local verification, fresh CI, commits/merges and human acceptance.
- [Representative statements](acceptance-fixture.md), [review workbook](reviewer-workbook.md) and [owner pack](owner-review-pack.md) show accounting examples and pending policy fields.
- [Financial restore evidence](recovery-evidence.json), [recovery runbook](../operations/backup-restore.md) and [deployment/rollback procedure](../operations/deployment.md) define what was tested and what the provider/operator must still establish.

## Release gate

| Item | Current state |
| --- | --- |
| F01–F40 source | Merged through PR7 |
| F41–F48 engineering/review-pack source | Merged through PR8 at62128ee |
| F46 populated recovery and complete final regression | Passed1,218 local tests,both builds/type/lint; see progress/results |
| F47 review pack | Prepared for Talha; actual human review/policy acceptance pending |
| Fresh CI | Final PR44781169698 and [merged main44882423627](https://github.com/TalhanAhmad/ERP-SYSTEM/actions/runs/44882423627) passed |
| PR8 merge | Completed 21 November 2026, 62128ee |
| Hosted finance migrations/runtime ACL/scanner verification | Not performed |
| Real fiscal calendar/chart/tax/assets/investments/opening policy | Pending owner review |
| Real opening import and independent reconciliation | Not performed |
| Hosted backup/PITR/object retention and restore rehearsal | Pending operator decisions |
| Live finance owner/grants, provider MFA and activation | Not configured |

## Observed final engineering evidence

Final local engineering acceptance passed 1,218 distinct tests:353 unit5.64s,802 actual PostgreSQL454.42s,63 Chromium4.7m. The complete browser run includes the new combined nine-source journey19.1s and lost committed-response recovery9.0s, ERP roles/HR/attendance/leave/assignments/announcements/invitations, private files/scanning/exports, mobile/keyboard/WCAG and retained correction/access boundaries. Both normal and Supabase-shaped production builds, strict TypeScript/lint,250 concrete API contracts and all84 applied source checksums pass.78 recovery-focused checks additionally passed25.35s after strengthening column/trigger/owner/grantor/index/RLS comparisons; they are included in the distinct full-suite count, not added again.

PR7 is merged at a2a1814d0c9629f8840a8bf13367b27007085077. F41 e758baa, F42 f62a4fa, F43 608ab0a, F44 bb14c49, F45 c097849, F46 85072d4 and F47 review pack703cc14 were separately committed/pushed in draft PR8. CI client preparation correctionb8b2a1f reuses the existing PostgreSQL17 image. F44 exact-head CI44774304395 and F45 exact-head CI44775856017 passed. F46/F47 initial CI preparation failed on missing Ubuntu client17; failed runs remain recorded and no tests were skipped. Fresh corrected/final source CI is an independent gate, linked from PR8 checks; no success is inferred before it actually completes.

## Risks and limits

Synthetic local databases verify checked application workflows and PostgreSQL17 accounting/security behavior; hosted provider networking, credentials, private Storage/scanner and operational restore require explicit staging verification. Company accounting decisions are not derived from examples. The initial application is PKR-only and uses the implemented reviewed measurement/recognition policies; unsupported accounting rules require a reviewed change. Scheduled recurring workers create drafts only. Access revocation stops future requests, while previously downloaded data remains outside recall. Keep finance disabled if a release control fails.

## Decision to fill after evidence review

Decision maker/date: Pending. Engineering source: merge 62128ee7a24e5d2926fbceaae63c1ea55a56aaad; passing merged-main CI: https://github.com/TalhanAhmad/ERP-SYSTEM/actions/runs/44882423627. Human review/policies/effective dates accepted: Pending. Staging verification and backup evidence: Pending. Intended hosted target and chosen initial grants: Pending. Accepted remaining risks/change list: Pending. Launch decision: Pending. Operator and rollback owner: Pending.

Default remains disabled. A future explicit staging/live launch decision must identify the target, approved policies/cutover and security/recovery controls. No paid upgrade, domain purchase or real-data import is included in this engineering completion.


## Final Linux follow-up — 20 November2026

Corrected recovery clients passed all58 cutover/automation and18 acceptance/restore cases on Linux in CI44778293871. That run's799/802 backend result exposed an existing closing concurrency case exceeding5000ms and two dependent fixture failures. Only that two-order workflow now has a30000ms test budget; no SQL/production timeout or assertion changed. All21 closing cases passed21.24s locally, with type/lint. Prior report headb85a1ae also passed all802 backend tests in fresh CI44779091761; its later stages and the final follow-up source CI remain separately observed through PR8 checks.


## Post-merge observation — 21 November2026

PR #8 merged into main on 21 November 2026 at 12:54:56 Asia/Karachi, merge 62128ee7a24e5d2926fbceaae63c1ea55a56aaad. Its final source a14bc0d43b59fc3ad52da8a084a08454c9497274 passed CI 44781169698 before merge. The merged main passed [fresh CI 44882423627](https://github.com/TalhanAhmad/ERP-SYSTEM/actions/runs/44882423627): migrations, TypeScript/lint, unit/PostgreSQL/browser suites, both production build modes and API/documentation checks. A complete git tree comparison confirms the merge contains exactly the verified PR files. The earlier local 1,218-test result remains recorded separately: 353 unit, 802 PostgreSQL, 63 Chromium. Historical failed runs/corrections remain retained.

Read-only Vercel inspection found the canonical workspace still points to READY production deployment dpl_2SSKGD2xS2jojkBuHhoqN6xjLCa4, created before this merge. Vercel returned no source commit metadata, so this is not proof of a deployment of merged main. Public checks: /login 200 with the sign-in form; anonymous /dashboard 307 to /login; anonymous /api/v1/finance/status 401 UNAUTHENTICATED. The 401 proves authentication is required, not the finance feature flag, schema, grants or readiness. No hosted migrations, deployment, environment changes, grants or financial activation were performed during this post-merge pass.

F01–F46 engineering and the F47/F48 review/release packs are complete and merged. Actual company policy/reviewer acceptance and a separate finance staging/live setup remain. The next phase needs the user choice between an isolated synthetic finance demo and real company setup; this choice is pending. No company accounting decisions or test data are silently adopted for live books.


## Local review demo — 22 November 2026

Talha selected the isolated synthetic finance demo and then chose to keep it local after Supabase rejected a separate free project for account capacity. The persistent six-role local demo is delivered; [guide and actual verification](isolated-demo.md) record the link, private credential location, sample statements, start/stop commands and limits. No hosted finance activation, real books/policy acceptance or paid upgrade occurred. Human company review and any future hosted finance setup remain pending.
