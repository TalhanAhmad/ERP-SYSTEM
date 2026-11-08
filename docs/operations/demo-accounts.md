# Owner exploration accounts

On 8 November 2026, the owner requested a persistent test login for each role below SUPER_ADMIN. These are live personal-demo accounts in Supabase and application PostgreSQL. They remain ACTIVE for manual exploration; they are separate from retired automated acceptance fixtures.

| Role | Login email | Username | Display name |
| --- | --- | --- | --- |
| HR_ADMIN | encova.hr.demo@example.com | demo.hr | Demo HR Admin |
| TEAM_LEAD | encova.lead.demo@example.com | demo.lead | Demo Team Lead |
| MEMBER | encova.member.demo@example.com | demo.member | Demo Member |

Use https://encova-workspace.vercel.app/login. Passwords were handed directly to the owner and retained only in ignored owner-readable .local/deploy/demo-exploration-state.json. They do not belong in Git, reports or client code. These reserved example addresses are synthetic and cannot receive normal reset/invitation mail; current Resend delivery is restricted to the owner's inbox.

The accounts were provisioned through authorized invitation creation and controlled synthetic acceptance using the existing application services. Public registration stays disabled. No invitation was sent to a third-party inbox. The owner account was preserved.

## What to explore

- Team Lead manages Demo Workspace — explore your roles. One Member task is ready to start; a second contains a submitted revision ready for approval or changes requested. The owner is also a project member.
- Member can start and submit their assigned work, inspect the submitted revision, use their attendance schedule and view the pending demo leave request.
- HR Admin can inspect the demo schedule assignments and approve/reject the Member's pending leave request. HR does not automatically see the work project without membership.

All three have a clearly named synthetic daily schedule starting on the creation date. No attendance check-in/out events were fabricated. These records are intended for exploration and may change when the owner uses the accounts; do not assume the initial task/leave states are permanent fixtures.

## Verification and lifecycle

Twelve targeted live checks passed: all three API sign-ins with intended roles; Team Lead project/membership; assigned/reviewable sample tasks; HR schedule/leave setup; restricted Operations/privileged invitations; project membership scope; each role's actual 360px browser login/scoped screen/sign-out; and final active-account retention. The Team Lead review screenshot was inspected.

Initial sample-project setup did not complete on its first attempt; resumed with saved account state and stable request keys, then verified the expected project/work records and completed all checks. No permission policy or application source was changed to create these accounts.

Leave these three accounts active until the owner asks to retire them. Ordinary automated smoke-test cleanup must target only its own generated fixture IDs. Before staff rollout, review/retire demo access and replace synthetic addresses with verified employee invitations through the supported onboarding process.
