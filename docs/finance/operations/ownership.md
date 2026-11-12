# Finance ownership operations

Implemented F04; live finance remains disabled. This is not authorization to migrate or activate the live application. The intended owner remains the account Talha explicitly selected in decisions.md; no hosted grant is created by these instructions.

## Authentication and boundaries

Every access mutation requires the current verified session, current ACTIVE SUPER_ADMIN role, active finance grant and current ownership (except acceptance by the intended recipient). The server verifies the current password again. Supabase additionally requires a verified TOTP factor and a fresh challenge/code, even when the general ERP MFA policy is optional. A process-local WeakMap capability binds verified identity/session/time to one operation/key; it is never returned to the browser or reconstructed from JSON. SQL independently checks the current session, role, grant, owner, version and a five-minute verification window. SQL trusts the server's provider-verification boundary; it does not itself verify TOTP.

Local Better Auth password-only compatibility is permitted only when both APP_URL and the database are loopback and no VERCEL_ENV is set. This is a development/test path, not a hosted MFA bypass. Provider contract tests use the real SDK with a mock HTTP provider; they do not establish physical live-device acceptance. See [Supabase TOTP documentation](https://supabase.com/docs/guides/auth/auth-mfa/totp).

## Controlled bootstrap

1. Finish the reviewed finance migrations in the intended environment; keep ordinary application runtime credentials separate from migration/operator credentials. The runtime role cannot invoke bootstrap/recovery.
2. Resolve the explicitly approved owner's immutable Person UUID and current username. Verify ACTIVE SUPER_ADMIN, provider binding and human identity; do not select the first administrator or grant every administrator.
3. The owner signs in using their own browser and, for Supabase, enrolls/verifies their authenticator through Account security. No operator silently creates a factor or replaces their password.
4. On the trusted operator machine create a mode-0600 JSON file directly under .local/finance. It contains cookie (the owner's own authenticated request Cookie header), password, code (fresh six-digit Supabase TOTP), and reason. Keep it out of chat, Git, terminal arguments, screenshots and shared logs. It is consumed/deleted by the command, including normal authentication/domain failures. Never use another administrator's session as a substitute.
5. Set FINANCE_ENABLED=true for this controlled process, FINANCE_OWNER_ID, FINANCE_OWNER_USERNAME, FINANCE_CREDENTIAL_FILE (that private file), and FINANCE_OPERATOR_ACK=BOOTSTRAP_EXPLICIT_OWNER. Supply the controlled DIRECT_URL for non-loopback operation and the existing provider/TLS configuration through private environment configuration. Run pnpm finance:owner.
6. The command verifies the same owner's password/TOTP and exact UUID/username, then initializes one owner, their grant and restricted audit atomically under the administration lock. Existing ownership causes a conflict. It imports no accounts, balances or financial examples. Inspect authorized /finance/access and preserve the audit record.

No bootstrap/recovery HTTP endpoint exists. Do not paste credentials here or grant runtime execution of the setup function. The command has been exercised only with isolated synthetic identities; actual hosted owner enrollment/setup is pending.

## Normal administration

The current owner grants another ACTIVE Super Admin through /finance/access with a reason and fresh verification. Grant the intended successor first, then request transfer. Transfers expire after 24 hours and require the target's fresh verified acceptance. The current owner remains responsible until acceptance. They can cancel a pending transfer. On acceptance the former owner retains selected access; the new owner may explicitly revoke it.

Revocation immediately blocks subsequent finance requests; queued work must re-enter the shared guard. Already downloaded information cannot be recalled. Owner revocation/demotion/deactivation/deletion is blocked; transfer first. The database checks these invariants regardless of FINANCE_ENABLED. Generic People routes cannot assign grants or ownership, and selected identity provider bindings cannot be replaced. Verified own-email synchronization is a narrowly marked self-service transaction.

Mutations use permanent finance-only receipts keyed by actor/operation/request key. Same-input replay returns the canonical result after current authorization checks; changed input conflicts. Passwords, codes and cookie headers are excluded from receipts and audit. A lost response can be retried with the original business request key and fresh verification. Operator/database roles remain privileged infrastructure actors.

## Controlled recovery

Recovery is an exceptional operator action, never an application-wide recovery permission. Obtain a separate recovery request and company authorization, verify the intended new owner's identity through an independent approved channel, and record the operator identity plus evidence/ticket reference privately. The target must already be an explicitly approved ACTIVE SUPER_ADMIN and must authenticate using their own current password and, on Supabase, fresh TOTP. Do not reset another user's password, email, MFA or provider binding through generic administration.

Use the same private-file procedure, with FINANCE_OPERATOR_ACK=RECOVER_IDENTITY_VERIFIED and FINANCE_OPERATOR_EVIDENCE containing a bounded operator identity/evidence reference (not identity-document contents). The controlled database connection is required. The command changes ownership atomically, revokes the former owner's grant and application/legacy sessions, cancels pending transfers and records FINANCE_OWNER_RECOVERED with its reason/evidence reference. It cannot recover to an inactive/non-admin identity or repeat recovery to the current owner.

The software records the operator's attestation; it does not perform or certify the human identity check. Recovery was tested only with owned synthetic data. No real recovery or owner credential/MFA change was performed.

## Locks and privileged functions

Finance access commands take administration advisory lock 987661, then actor/target Person row locks, per-person finance advisory locks (629813, hashtext(Person ID)), and the singleton row. Generic users/* and PATCH:users/* mutations acquire that administration lock before their actor row. Shared reads retain their Person/grant locks through the protected query. Direct operator SQL must follow the documented protocol.

The runtime receives SELECT on finance control/receipt tables and EXECUTE only on encova_finance_access_command. It cannot write grants/settings directly or call encova_finance_setup_owner. SECURITY DEFINER routines use pg_catalog search_path, qualified table names and explicit execution revocations; see [PostgreSQL function security](https://www.postgresql.org/docs/17/perm-functions.html). Infrastructure operators who can change tables/functions remain privileged.
