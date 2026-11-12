# Finance risks

- No posting engine or financial reports exist in this foundation. Screens must not display invented zero balances or readiness claims.
- F04 implements owner bootstrap/transfer/revoke, database last-owner/identity safeguards and provider step-up authentication, with final verification tracked in progress.md. Actual hosted migration, owner device enrollment and setup remain pending; no hosted owner is seeded.
- Finance grants are read-only to the runtime role. Owner operations now use a narrowly scoped function; operator bootstrap/recovery remains unavailable to the runtime.
- All future finance operations must use the shared access transaction; revocation must use the same Person → advisory-lock order. Direct operator SQL is privileged and must follow the documented protocol.
- PostgreSQL RLS protects against anonymous/authenticated Data API access; the shared server role remains privileged. Application services must check the current actor on every boundary.
- Financial policy and opening data require accountant/company review. No statutory, IFRS or Pakistan tax certification is claimed.
- Finance has no production/staging deployment, financial backup proof or attachment scanning service yet. ERP recovery evidence is not finance recovery evidence.

## F05 limits

No ledger/posting engine yet; account/period setup does not establish balanced books. F06 must lock period, posting accounts and ancestors and mark usage in the same transaction as the first posting, proving races against setup changes. Closing/reopening is F39. Company chart/fiscal year remain unset. Parent option lists are bounded to the first 100 active groups (existing parent retained); complete searchable selection is scheduled with shared registers/F10. No real books should rely on a synthetic fixture or inferred tax/asset/reporting policy. Both fresh migrations and full CI remain separately evidenced in testing/results.md.
