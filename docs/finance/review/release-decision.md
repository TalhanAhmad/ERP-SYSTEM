# F48 release decision record

Status: engineering release preparation complete locally; live finance disabled. This record provides a concrete review point, not permission to infer company policy or import books.

## Evidence to review

- [Finance progress](../progress.md), [verification results](../testing/F26-F48-results.md) and [milestone records](../planning/milestones.md) distinguish local verification, fresh CI, commits/merges and human acceptance.
- [Representative statements](acceptance-fixture.md), [review workbook](reviewer-workbook.md) and [owner pack](owner-review-pack.md) show accounting examples and pending policy fields.
- [Financial restore evidence](recovery-evidence.json), [recovery runbook](../operations/backup-restore.md) and [deployment/rollback procedure](../operations/deployment.md) define what was tested and what the provider/operator must still establish.

## Release gate

| Item | Current state |
| --- | --- |
| F01–F40 source | Merged through PR7 |
| F41–F47 engineering/review-pack source | Separately committed/pushed in draft PR8 |
| F46 populated recovery and complete final regression | Passed1,218 local tests,both builds/type/lint; see progress/results |
| F47 review pack | Prepared for Talha; actual human review/policy acceptance pending |
| Fresh CI | F44/F45 passed; corrected/final source checks independently linked from PR8 |
| New PR8 merge | Pending separate review/merge instruction |
| Hosted finance migrations/runtime ACL/scanner verification | Not performed |
| Real fiscal calendar/chart/tax/assets/investments/opening policy | Pending owner review |
| Real opening import and independent reconciliation | Not performed |
| Hosted backup/PITR/object retention and restore rehearsal | Pending operator decisions |
| Live finance owner/grants, provider MFA and activation | Not configured |

## Observed final engineering evidence

Final local engineering acceptance passed1,218 distinct tests:353 unit5.64s,802 actual PostgreSQL454.42s,63 Chromium4.7m. The complete browser run includes the new combined nine-source journey19.1s and lost committed-response recovery9.0s, ERP roles/HR/attendance/leave/assignments/announcements/invitations, private files/scanning/exports, mobile/keyboard/WCAG and retained correction/access boundaries. Both normal and Supabase-shaped production builds, strict TypeScript/lint,250 concrete API contracts and all84 applied source checksums pass.78 recovery-focused checks additionally passed25.35s after strengthening column/trigger/owner/grantor/index/RLS comparisons; they are included in the distinct full-suite count, not added again.

PR7 is merged at a2a1814d0c9629f8840a8bf13367b27007085077. F41 e758baa, F42 f62a4fa, F43 608ab0a, F44 bb14c49, F45 c097849, F46 85072d4 and F47 review pack703cc14 were separately committed/pushed in draft PR8. CI client preparation correctionb8b2a1f reuses the existing PostgreSQL17 image. F44 exact-head CI44774304395 and F45 exact-head CI44775856017 passed. F46/F47 initial CI preparation failed on missing Ubuntu client17; failed runs remain recorded and no tests were skipped. Fresh corrected/final source CI is an independent gate, linked from PR8 checks; no success is inferred before it actually completes.

## Risks and limits

Synthetic local databases verify checked application workflows and PostgreSQL17 accounting/security behavior; hosted provider networking, credentials, private Storage/scanner and operational restore require explicit staging verification. Company accounting decisions are not derived from examples. The initial application is PKR-only and uses the implemented reviewed measurement/recognition policies; unsupported accounting rules require a reviewed change. Scheduled recurring workers create drafts only. Access revocation stops future requests, while previously downloaded data remains outside recall. Keep finance disabled if a release control fails.

## Decision to fill after evidence review

Decision maker/date: Pending. Exact release source/head and passing CI URL: Pending. Human review/policies/effective dates accepted: Pending. Staging verification and backup evidence: Pending. Intended hosted target and chosen initial grants: Pending. Accepted remaining risks/change list: Pending. Launch decision: Pending. Operator and rollback owner: Pending.

Default remains disabled. A future explicit staging/live launch decision must identify the target, approved policies/cutover and security/recovery controls. No paid upgrade, domain purchase or real-data import is included in this engineering completion.
