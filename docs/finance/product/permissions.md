# Permissions

Finance requires FINANCE_ENABLED=true plus a current database ACTIVE Person with SUPER_ADMIN role and an unrevoked explicit FinanceGrant. A caller-supplied role, prior status, earlier success or Super Admin role alone is insufficient. Lower roles remain denied even if an operator inserts a grant for a negative test.

The runtime cannot create/update/delete grants in this first milestone. No grant/owner management API exists. F04 must implement current-owner-only grant/revoke, atomic bootstrap, transfer acceptance, last-owner protection, credential-takeover guards, fresh reauthentication and live MFA before enabling management.

All finance data queries execute in the same authorized transaction. Pending/background execution must re-enter this guard; it cannot retain an earlier authorization. Future file downloads and export release must do the same. Generic People schemas reject finance fields. General Audit remains separate from FinanceAuditEvent.
