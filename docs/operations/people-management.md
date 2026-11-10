# Super Admin account management

Super Admin opens People, searches by name, username or email, filters by status/role, and selects Manage on an account. The directory defaults to active accounts, uses 25-row pages, and keeps later/inactive accounts reachable. Invalid filter values are rejected; a page beyond the result range resolves to the last available page.

## Profile and access controls

The account page shows login email, current role/status, open-assignment and managed-project counts, and the ten most recent account-management events with their actor, time and optional reason.

Profile editing changes display name, username and employee/intern classification. Login email stays unchanged: changing the provider identity requires its own verified email flow. Usernames are normalized and cannot take another account's username or a live pending invitation reservation. No provider IDs, password fields, session records or private contact fields are included in the management DTO.

Demoting a Team Lead to Member preserves project membership/history but removes manager write privileges, including when the stored project manager reference is retained.

Role changes and deactivation require a deliberate checkbox and reason in the UI. Deactivation denies workspace access and retains assignments, attendance and history. It does not automatically reassign open tasks or remove project membership; review the displayed counts before acting. The UI can reactivate an inactive account only when a sign-in identity is linked. Reactivation preserves role and password and does not provision a replacement identity or remove provider restrictions.

A Super Admin can edit their own profile, but another Super Admin must change their role or deactivate them. The existing serialized last-active-admin guard remains. All writes require an active, current-role actor, matching Origin/CSRF, request/idempotency keys and the displayed person version. Profile/access changes lock the same person record so a stale edit cannot overwrite a competing role/status change. Unchanged profile/role saves do not increment versions, add change events or revoke sessions.

## Session and permission behavior

The local compatibility provider revokes sessions on role/status changes. The hosted provider is verified on every request, and migration seventeen adds registered app-session IDs. Role/status changes and reactivation clear prior app sessions; restoring a role/account does not reactivate an old browser cookie. The user signs in again with the unchanged password. Own all-device sign-out immediately denies app access and requests Supabase global refresh-token revocation. An enrolled factor requires AAL2 for normal access. See tables-security-recovery.md for the token-expiry boundary and owner MFA rollout.


Only Super Admin can open the management page or management APIs. The focused HR four-screen scope remains unchanged. Team Lead/Member keep their existing scoped read-only directory and cannot read administrative account detail or mutate profiles/access.

## Scope and verification

No schema migration or email delivery is required. Existing invitations/resend/revoke remain on People. Department/team administration, verified login-email changes, private employee profile fields, task reassignment and broader provider-session lifecycle controls remain future work.

Verification covers paginated search/filters and safe DTOs, normalized profile edits, reserved usernames, replay/no-op behavior, stale/concurrent changes, mutually competing admin deactivations, self/last-admin protection, retained work, linked reactivation and direct API scope/Origin checks. Browser acceptance covers search, profile edit, role change, inactive filtering, deactivation/reactivation, new sign-in, mobile layout, HR denial and protected self-management.

## Hosted acceptance

Source d7fd89dd9a1050fde4e173296cc772fedd05dfff passed [CI 42515443745](https://github.com/TalhanAhmad/ERP-SYSTEM/actions/runs/42515443745). Deployment dpl_14WHhC1sBzQ9JnYovXcnK9ewagNW passed 22 hosted checks, including actual profile/role/status forms, demotion privilege removal, suspension/restore with retained work, safe account history, protected owner controls, HR denial and 360px layout. All four existing owner/demo logins remain valid. Only the uniquely identified synthetic verification account was deactivated after testing; its work/audit records remain retained. No schema or credential migration occurred.
