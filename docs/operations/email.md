# Transactional email

Talha selected Resend. No domain is owned yet, so the current setup uses the provider's restricted personal-demo sender, onboarding@resend.dev. It can send only to the email address on the Resend account. Invitations to other recipients require a verified sending domain. This is not a company-wide email rollout.

## Two separate delivery paths

Application invitations use the durable PostgreSQL outbox and Nodemailer. Creating or resending an invitation attempts one scoped send after the authorized database transaction commits. It cannot drain unrelated queued messages. Missing settings leave the message queued; SMTP failures retain the message with bounded retries and a safe error code. The People page shows queue/server-acceptance status. SMTP acceptance alone does not prove inbox placement.

Supabase Auth sends hosted password resets itself. Its custom SMTP settings must be configured separately. The browser always receives the same reset response for eligible/missing accounts and delivery failures; a successful response is not proof of delivery. Preserve disabled public signup, exact callback URLs and password policy when updating SMTP.

Remote SMTP requires TLS and certificate validation. Port 465 uses implicit TLS. Resend sends include a stable outbox-based Resend-Idempotency-Key in addition to Message-ID; provider deduplication has its own retention window and is not an unlimited exactly-once guarantee. Leased retry/recovery and cancellation still apply. Expired, accepted and revoked invitations are excluded from new claims; an already in-flight old message can arrive but cannot authorize a canceled token.

## Personal demo restriction

Configure SMTP_HOST=smtp.resend.com, SMTP_PORT=465, SMTP_USER=resend, SMTP_FROM=onboarding@resend.dev, and a private send-only API key as SMTP_PASSWORD. SMTP_TEST_RECIPIENT must be the Resend account's own email address. The application rejects other recipients before SMTP submission and displays a demo notice to administrators. Supabase's sender is also subject to Resend's account-recipient restriction.

The existing owner already has an account, so this restriction does not provide a full new-person invitation demo to that same email address. Test invitation queue/lifecycle behavior with synthetic fixtures locally; verify the real mail transport and owner's reset inbox separately. Do not describe restricted sender setup as employee onboarding.

The optional private .local/deploy/resend-smtp.json is ignored by Git and owner-readable only. Never place its key in chat, reports, NEXT_PUBLIC variables, command arguments or committed files. The official Resend CLI can authenticate through browser OAuth and create a send-only SMTP key without pasting a key into chat. Vercel stores the six SMTP server settings as production environment secrets; Supabase stores its own SMTP configuration.

Run pnpm email:verify .local/deploy/resend-smtp.json to verify connection/authentication without sending an email. This does not prove sender-domain authorization, inbox delivery or password-reset completion. The verifier emits generic failures, including for malformed configuration files.

## Enable real invitations later

Add a domain you own to Resend and publish the provider-generated DNS records. A sending subdomain can isolate transactional mail; preserve existing inbound mail records. Keep click tracking disabled for authentication links. After verification, change SMTP_FROM to the verified address in Vercel and Supabase Auth, remove SMTP_TEST_RECIPIENT from the application configuration, redeploy and test a controlled invitation and password reset end to end. Domain purchase, DNS ownership and company sender approval remain external dependencies.

The daily attendance cron sends no email. Resend an invitation from People to replace its link and attempt fresh delivery. pnpm worker remains an explicit operator action that processes at most one queued email per pass; check the intended environment and queued recipients first. An unattended retry worker, bounce alerts and broader email monitoring remain backlog work.

Provider references: [Resend SMTP](https://resend.com/docs/send-with-smtp), [default sender restrictions](https://resend.com/docs/knowledge-base/403-error-resend-dev-domain), [verified domains](https://resend.com/docs/dashboard/domains/introduction), [Supabase custom SMTP](https://supabase.com/docs/guides/auth/auth-smtp).

## Verified demo evidence

The real SMTP self-test and the password reset requested from the live Vercel form both arrived in the owner's Gmail INBOX. The owner password was preserved. A separate controlled synthetic provider recovery token completed the live callback/form/password change and left the disabled domain account denied. Source 4d76a19 passed CI 42481163707; deployment dpl_H4vyzvankZvxXRABivHg8Z9nk3vc passed 71 named live checks. See [verification results](../testing/results.md) for scope and remaining dependencies.
