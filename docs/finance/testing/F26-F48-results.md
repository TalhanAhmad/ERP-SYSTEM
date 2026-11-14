# Finance continuation verification — 14 November2026

## F26 local verification

Additive56–59 passed rollback rehearsal and applied to the dedicated encova_test database.249 unit tests passed2.94s;485 actual PostgreSQL integration tests passed192.93s after fixture corrections. Sixteen new lifecycle integration cases cover permanent month identity and reopening, final-paisa residual floor, stale/out-of-order drafts, tiny zero monthly events, disposal and net results/fees, retained purchase capacity, dated reversal, prospective impairment policy, concurrent request replay, current-cost private reads/role denial, SQL privilege boundaries, locked initial policy/cached balances, editable same-source draft mappings, over-impairment/negative correction and closed/future-period rejection. Three new schema cases cover strict exact money, forged IDs/caches, valid months/dates and bounded filters.

The initial execution failure in a composite-row proof was corrected through a separate additive57, preserving applied56. Full regression exposed two old test assumptions: globally maximum period plus days can exceed year9999; a hardcoded missing date1800 becomes covered by new fixtures. Both tests now choose actual unused bounded dates. The complete485-case backend suite passed after the policy correction; all16 lifecycle cases additionally passed after the final audit-precision59 (15.12s). No source/GL/audit history was removed to make tests pass.

All45 Chromium journeys passed2.6m, including the new actual generation/post/disposal/reversal/private/mobile/WCAG journey. A first setup attempt lacked normalized existing bill defaults; corrected the fixture without weakening the command. Full-browser checks also corrected an older paginated bill selector and the browser variant of the maximum-date assumption. An attempted rerun without renewing synthetic auth fixtures after backend tests was stopped and restarted through test:e2e:prepare. Failed/stopped attempts are not counted as acceptance. Known stranded synthetic owner cleanup retained all financial history.

779 distinct checks passed (249+485+45). Typecheck/lint, local build,124 concrete API paths/verbs/references, all59 applied SQL checksums and Word/private-value checks passed. Supabase-mode production build passed with synthetic configuration. Source publication/fresh CI are being recorded separately. No fresh-runner result is extrapolated from the local runs.

## Remaining milestones

F27–F46 implementations and final cross-module acceptance remain pending. F47 review pack preparation was requested by the user; human acceptance fields stay unfilled. F48 release remains separate. Hosted finance is disabled; all financial examples in this report are synthetic, with no live schema/grants/seeds or bank/trade operation.


## Final lifecycle edge cases

Prospective plans may reuse unposted future-month identities through explicit refresh; they cannot overwrite consumed posted months. Unused policy correction is a dated event without GL, while consumed policy cannot be reversed. Disposal clears multiple actual accumulated controls and separates fees larger than proceeds into a net cash outflow. Audit amount/fee/residual fields are exact decimal strings. Source/month and state/date indexes support bounded registers. Additive58/59 preserve all earlier applied checksums.

## F27 local verification

Additive60 passed transaction rollback rehearsal and guarded encova_test deployment.15 new backend/3 schema cases passed18 (9.98s): single ERP identity/replay, signed activation/freeze, exact approved variations/capacity and concurrent reductions, nonposting/advisory milestones, real posted-line annotations, wrong project/client/draft/duplicate rejection, retained release/relink/cancellation, frozen snapshots/archived work, current manager/role/selected access, draft versions/cancellation retention, runtime/Data API boundaries, private Origin/flag HTTP checks, complete pagination and deferred forged-source rejection. The first missing-membership fixture was corrected; it did not require widening project or finance permissions.

Full252 unit (3.23s) and500 PostgreSQL (195.76s) passed. Type/lint/local build,142 concrete API paths and all60 applied checksums passed. Actual Chromium contract confirmation, signed variation, milestone, selected-writer link/release, manager denial, mobile and WCAG passed6.2s (6.0s again in full regression). All46 browser cases passed2.6m.798 distinct checks passed (252+500+46). Supabase-mode build passed with synthetic configuration. The first browser fixture counted period setup as a seventh fresh-auth HTTP write; moved that prerequisite into the checked operator fixture path, preserving the production limit and all six owner form actions. Final publication/private-value/Word checks accompany the source push. Earlier F26 source4b0e4a6 passed fresh CI43599585247, including59 migrations, all779 tests, both builds and124-path docs. F27 source publication/fresh CI is recorded separately; future results are not claimed.
