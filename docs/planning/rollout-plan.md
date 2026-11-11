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
- Word report updated; owner/demo credentials, owner MFA enrollment and billing remain unchanged. The subsequently confirmed operating rules are recorded in operations/company-policy.md.

## Awaiting human/company input

The owner confirmed Monday–Saturday working days; that company setting is saved live. The 09:00–17:00 shift is accepted and assigned from 12 November. The 17:00 report deadline is also confirmed and verified. HR approval-only leave with no fixed annual quota is also confirmed and live-verified. A sender domain is still pending. Device enrollment must be completed by the owner at /security; no authenticator secret is generated for them by this agent. Named employee inbox/pilot approval, company hosting/billing and Auth/PITR/off-site retention choices remain company decisions. Current engineering checks do not substitute for those choices or real-user approval.

Workweek update: Monday–Saturday was explicitly confirmed and saved live on 11 November. Sunday is the company weekly off day. Employee schedules now use the accepted 09:00–17:00 shift prospectively from 12 November; earlier assignment segments and history are preserved. See company-policy.md in the operations directory.

Operating-rule collection is complete: Monday–Saturday, 09:00–17:00 Asia/Karachi from 12 November; 17:00 reports; HR-approved leave without an automatic annual quota. Remaining rollout items are the sender domain/inbox acceptance, owner device enrollment, actual human pilot/company hosting decisions and managed Auth/PITR/off-site strategy.
