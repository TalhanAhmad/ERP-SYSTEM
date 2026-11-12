# Permissions

Finance requires FINANCE_ENABLED=true plus a current database ACTIVE Person with SUPER_ADMIN role and an unrevoked explicit FinanceGrant. A caller-supplied role, prior status, earlier success or Super Admin role alone is insufficient. Lower roles remain denied even if an operator inserts a grant for a negative test.

F04 implements current-owner-only grant/revoke and transfer/cancel, intended-target acceptance, fresh password and mandatory fresh Supabase TOTP, current-session checks, owner/selected-identity database guards and atomic restricted receipts/audit. The runtime still cannot write grant/settings tables directly; it calls one narrowly scoped audited database function. Bootstrap/recovery uses an operator-only function and controlled command, with explicit identity binding and no public endpoint. See [ownership operations](../operations/ownership.md). Live setup remains pending.

All finance data queries execute in the same authorized transaction. Pending/background execution must re-enter this guard; it cannot retain an earlier authorization. Future file downloads and export release must do the same. Generic People schemas reject finance fields. General Audit remains separate from FinanceAuditEvent.

## F05 setup authorization

Only the current Finance Owner with an active explicit grant can mutate accounts/periods. Selected active Super Admins read setup records and restricted history. Inactive/demoted/unselected users and HR/Lead/Member receive no finance access. API, Server Components and direct services share the same current-state guard; mutations recheck inside the restricted SQL command after fresh authentication. There are no runtime direct config-table writes or public generic finance mutation routes. No monetary posting permission is introduced by setup access.

## F06–F10 permissions

Current active selected finance Super Admins may read and write ordinary journal drafts and post/reverse with fresh password plus hosted fresh TOTP. This is authorization, not independent reviewer approval. Protected control accounts remain categorically denied. Only the current owner changes parties/cash/account/period setup; other selected users have read-only setup screens/APIs. Lower/unselected/inactive/demoted/revoked users remain denied before financial read/validation, including drawer and option queries. User/project relations carry IDs only in restricted finance tables, never financial fields in ordinary profiles.
