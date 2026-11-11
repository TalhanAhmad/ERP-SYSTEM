# Company rollout work — 10 November 2026

Authorized: finish remaining independent implementation and verification; preserve owner/demo identities, focused HR menus, Vercel Hobby billing and company-policy defaults until the owner supplies actual values. No automatic domain purchase, plan upgrade, owner authenticator enrollment or in-place production restore.

1. Implement provider-confirmed own login-email changes with password reauthentication, current MFA/session checks, safe callbacks, immutable domain IDs, atomic email synchronization and session revocation; keep disabled while employee email delivery is restricted.
2. Verify a consistent hosted public-schema logical backup into isolated local encova_restore and a new synthetic private Storage object's backup/restore. No source object overwrite/delete and no production database restore. Record precise limits (Auth/PITR/off-site are separate).
3. Recheck the owned synthetic role pilot, protected scheduler, provider configuration and owner/demo credentials. Record remaining domain/device/company decisions explicitly.
4. Run appropriate tests/CI, publish code, deploy and update the Word progress report.
