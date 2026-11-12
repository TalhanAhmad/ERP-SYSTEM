# Permissions

Finance requires FINANCE_ENABLED=true plus a current database ACTIVE Person with SUPER_ADMIN role and an unrevoked explicit FinanceGrant. A caller-supplied role, prior status, earlier success or Super Admin role alone is insufficient. Lower roles remain denied even if an operator inserts a grant for a negative test.

F04 implements current-owner-only grant/revoke and transfer/cancel, intended-target acceptance, fresh password and mandatory fresh Supabase TOTP, current-session checks, owner/selected-identity database guards and atomic restricted receipts/audit. The runtime still cannot write grant/settings tables directly; it calls one narrowly scoped audited database function. Bootstrap/recovery uses an operator-only function and controlled command, with explicit identity binding and no public endpoint. See [ownership operations](../operations/ownership.md). Live setup remains pending.

All finance data queries execute in the same authorized transaction. Pending/background execution must re-enter this guard; it cannot retain an earlier authorization. Future file downloads and export release must do the same. Generic People schemas reject finance fields. General Audit remains separate from FinanceAuditEvent.
