# F44 source, permission and ERP acceptance

The complete local suite passes1,209 distinct tests:351 unit,797 PostgreSQL integration across53 files and61 Chromium journeys. This includes earlier finance attachment/quarantine/scanner/private-file tests, direct ledger constraints, grant revocation, normal ERP login/assignment/attendance/HR/leave/announcement/invitation/report/table/operations workflows and all implemented finance source flows. It does not claim hosted financial activation or company/accountant acceptance.

## Current permission boundaries

| Surface | Verified boundary |
| --- | --- |
| Finance read data | Current ACTIVE SUPER_ADMIN and explicit current grant; ordinary super admin, HR, lead and member denied |
| New automation read modes | All eight modes deny unselected roles with403/private no-store, including unsupported filters; finance access is checked before validation details |
| Feature disabled | All new read modes and ten mutation actions stop with404 before source/authentication input processing |
| Ten automation/recognition/review mutation actions | A selected non-owner is denied; eligibility alone does not imply ownership |
| Worker claim/release | Stored original grant, current role/owner/schedule and live lease are checked again; a regrant never revives the original revoked epoch |
| Runtime DB role | Finance metadata tables remain read-only; posting cores and new trigger helpers are ungranted |
| Browser DB roles | No direct finance table reads/writes or internal helper execution |
| Source metadata | Independent SQL checks bind schedule creator/grant, due run/month/date, actual active lease/attempt and prepared output to the original template |
| Opening-credit reviews | Current owner, exact original draft inputs and eligible ordinary opening equity required; forged/stale/non-equity records rejected |
| Original books | Earlier applied migrations and retained journals/source proofs are not rewritten |

## Independent database checks

Additive83 adds insert checks for schedules/runs/attempts, a readiness proof for the actual normal bill/journal or unique asset/month source, and owner/input/equity checks for opening-credit reviews. These checks complement existing runtime write denial rather than replacing it. They reject invented histories or outputs even under operator-level invalid-write tests. Reviewed normal preparation remains compatible with all prior opening/automation/credit cases.

The owned suite now passes56 scenarios:40 prior cases plus16 new direct-write, mutation, private-read/feature and ACL cases. Revoke/regrant testing performs a valid ownership transfer, revokes the old grant, grants a new epoch and transfers ownership back inside a rolled-back owned transaction; an old queued job is still cancelled. No ownership guard was disabled and none of these operator fixture transitions changes live grants.

The first new readiness guard used a SQL variable colliding with a source column; corrected before dedicated primary test application. The API permission-first filter boundary was then added and tested without relaxing role assertions. A true wrapper-stripped rollback rehearsal and the full focused suite preceded83 application. All83 applied source hashes match; no prior migration was edited.

## Actual commands and outcomes

`pnpm test:unit`:351 passed5.46s. `caffeinate -di pnpm test:integration`:797 passed445.12s. After explicit encova_test fixture renewal, `PLAYWRIGHT_PORT=3100 caffeinate -di pnpm test:e2e`:61 passed4.4m. Focused56 passed12.84s. Normal and Supabase-shaped production builds, final strict typing/lint,250 concrete API contracts and Word/private-value checks are checked before publication. F45 combined browser/error-recovery and F46 financial restore/rollback follow; human review and release decisions remain unfilled.
