# Finance risks

## Current review position — 20 November2026

Engineering through F46 supplies the actual posting engine, typed subledgers, reports, private files/exports, closing, opening imports, reviewed draft automation and populated financial restore/rollback evidence. [Review workbook](review/reviewer-workbook.md) lists company decisions. Actual hosted migration/permissions/private scanner/Storage, live grants/MFA, real chart/fiscal calendar/tax/measurement/cutover approval and provider backup/PITR/object retention remain unconfigured. Synthetic acceptance is not accountant approval or a hosted recovery guarantee. Current source/test/publication status is in [progress](progress.md).

## Historical foundation risks (superseded as implementation advanced)

- At the initial foundation stage, no posting engine or financial reports existed. Screens must not display invented zero balances or readiness claims.
- F04 implements owner bootstrap/transfer/revoke, database last-owner/identity safeguards and provider step-up authentication, with final verification tracked in progress.md. Actual hosted migration, owner device enrollment and setup remain pending; no hosted owner is seeded.
- Finance grants are read-only to the runtime role. Owner operations now use a narrowly scoped function; operator bootstrap/recovery remains unavailable to the runtime.
- All future finance operations must use the shared access transaction; revocation must use the same Person → advisory-lock order. Direct operator SQL is privileged and must follow the documented protocol.
- PostgreSQL RLS protects against anonymous/authenticated Data API access; the shared server role remains privileged. Application services must check the current actor on every boundary.
- Financial policy and opening data require accountant/company review. No statutory, IFRS or Pakistan tax certification is claimed.
- At the initial foundation stage, finance had no deployment, finance-specific restore evidence or attachment scanner. F46 now provides local populated recovery; hosted deployment/scanner and operational recovery remain pending.

## F05 limits

No ledger/posting engine yet; account/period setup does not establish balanced books. F06 must lock period, posting accounts and ancestors and mark usage in the same transaction as the first posting, proving races against setup changes. Closing/reopening is F39. Company chart/fiscal year remain unset. Parent option lists are bounded to the first 100 active groups (existing parent retained); complete searchable selection is scheduled with shared registers/F10. No real books should rely on a synthetic fixture or inferred tax/asset/reporting policy. Both fresh migrations and full CI remain separately evidenced in testing/results.md.

## F06–F10 remaining limits

The ordinary-adjustment engine is verified; the full commercial invoice/cash/subledger dataset, financial statements, close/reopen and live accounting acceptance remain later work. Global structural serialization is deliberately conservative; no production-throughput guarantee is claimed. Complete parent search is now implemented; optional project/person selectors retain a 100-active-record UI bound. Supporting evidence is a required reference, not a claim that finance attachment scanning/upload/PDF generation already exists. Company policies/chart/year/opening books, hosted MFA setup, staging/recovery/accountant review and separate release approval remain outstanding. No finance feature is enabled live by a passing local/CI suite.
