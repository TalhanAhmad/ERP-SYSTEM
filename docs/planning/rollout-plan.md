# Company rollout work — 11 November 2026

Authorized: finish remaining independent implementation and verification; preserve owner/demo identities, focused HR menus, Vercel Hobby billing and company-policy defaults until the owner supplies actual values. No automatic domain purchase, plan upgrade, owner authenticator enrollment or in-place production restore.

1. Implement provider-confirmed own login-email changes with password reauthentication, current MFA/session checks, safe callbacks, immutable domain IDs, atomic email synchronization and session revocation; keep disabled while employee email delivery is restricted.
2. Verify a consistent hosted public-schema logical backup into isolated local encova_restore and a new synthetic private Storage object's backup/restore. No source object overwrite/delete and no production database restore. Record precise limits (Auth/PITR/off-site are separate).
3. Recheck the owned synthetic role pilot, protected scheduler, provider configuration and owner/demo credentials. Record remaining domain/device/company decisions explicitly.
4. Run appropriate tests/CI, publish code, deploy and update the Word progress report.

## Completed evidence

- Email capability implemented, gated off for restricted delivery; positive SDK/DB confirmation contracts plus safe public-page/browser checks pass.
- Actual hosted public ERP snapshot and all available private objects restored and verified in isolated targets; owned bucket cleaned.
- Full regression: 331 automated checks. Follow-up hosted checks: 44. Source fcb7bc7 passed CI 42976770350 and is deployed as dpl_2SSKGD2xS2jojkBuHhoqN6xjLCa4. Natural attendance/maintenance processing also succeeded on 11 November.
- Word report updated; owner/demo passwords, emails and MFA enrollment, company defaults and billing remain unchanged.

## Awaiting human/company input

The owner confirmed Monday–Saturday working days; that company setting is saved live. A sender domain and actual shift/report/leave rules are still pending. Device enrollment must be completed by the owner at /security; no authenticator secret is generated for them by this agent. Named employee inbox/pilot approval, company hosting/billing and Auth/PITR/off-site retention choices remain company decisions. Current engineering checks do not substitute for those choices or real-user approval.

Workweek update: Monday–Saturday was explicitly confirmed and saved live on 11 November. Sunday is the company weekly off day. Employee attendance schedules await shift hours; existing assignments/history were not rewritten. See company-policy.md in the operations directory.
