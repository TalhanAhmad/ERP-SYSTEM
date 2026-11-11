# Verified login-email changes

This capability uses Supabase Auth's secure email-change flow. It stays disabled in the personal demo because its sender can reach only the owner's inbox. Owner/demo login emails are unchanged. Basic administrative profile editing still cannot overwrite another person's login email.

A signed-in user opens Account security, enters a different email and their current password, and sends confirmation emails. A temporary provider client checks the password without replacing the browser's MFA session. The server checks current ACTIVE account/session/MFA access again before requesting a change. Both old and new inboxes must confirm; use the same browser for PKCE confirmations. Expired/partial confirmations show generic instructions and never reflect passwords, tokens, email addresses or an external next URL.

Before final provider verification, Person.email stays unchanged. After getUser verifies the provider identity and confirmed address, a locked transaction updates only that same Person's email/version, retains all domain IDs/work/history, clears other registered app sessions and records a metadata-only audit. Address conflicts stop safely for administrator review. Account administrators cannot use this mechanism to transfer another user's history to a different identity.

To enable after domain setup:

1. Verify the owned sender domain and configure working SMTP in both the application and Supabase Auth. Confirm actual delivery to two controlled independent inboxes, including password reset.
2. Keep public signup disabled and Auth email confirmations and double_confirm_changes enabled. Preserve existing exact callbacks and append `https://encova-workspace.vercel.app/auth/confirm?next=/security&flow=email-change`. Review the exact provider diff before pushing.
3. Remove the demo recipient restriction only after verified-domain delivery works. Set EMAIL_CHANGE_ENABLED=true in Vercel and redeploy; backend availability requires that flag, valid SMTP configuration and no test-recipient restriction.
4. With owned synthetic users, prove wrong-password/MFA rejection, both confirmation steps, unchanged pending email, final same-ID synchronization, conflict protection, history retention, old-session rejection and fresh new-address login. Retire only the owned fixtures. Do not change the owner email during acceptance.

Do not use the provider admin update-user endpoint to skip confirmation as an acceptance substitute. Provider identity administration remains a separately trusted operator capability. Automated contract tests simulate both-inbox confirmations; live inbox acceptance remains dependent on a sending domain and controlled inboxes.

Provider preparation on 11 November 2026 preserved existing callbacks and appended only the exact email-change callback; email confirmations were enabled while dual-address confirmation remained enabled. The application flag remains false and the restricted sender remains in place. This configuration preparation is not a claim of employee inbox delivery.
