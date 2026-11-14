# Finance F16–F25 delivery tracker

Requested scope: continue from merged F15 through F25; test and push each milestone separately. Branch finance/f16-f25 starts at main c56cc78. This tracker records actual completed work and pending work without treating the specification as an instruction to launch finance.

## Status
F16–F21 implemented and locally verified. F22–F25 pending implementation. Hosted finance remains disabled, without hosted schema changes, owner grants or financial seeds. No real tax, funding, investment or depreciation policy has been selected.

## F16 evidence
Bills and immediate paid expenses, exact cost/project splits, duplicate supplier reference protection and explicit same-amount review, versioned fresh-auth commands, immutable source/journal/AP events, supplier snapshots, current access and private audit. See [F16](planning/days/F16.md).

DDL rollback rehearsal and additive migration34 passed on isolated synthetic encova_test. Focused bill/invoice/customer80 passed; dedicated bill9 plus schema3 and one Chromium journey passed. Earlier unchanged unit suite216 passed. Type/lint/local production build and concrete64-path API documentation checks passed. Full backend regression passed355 cases; existing unit216 plus bill unit3 passed219 distinct unit cases. Focused browser bill journey passed1; prior34 browser cases will be rerun in final regression. Supabase-mode production build also passed using configuration fixtures only. Publication/CI evidence follows when observed.

## Pending milestones
F22 loans; F23 investment holdings/acquisition lots; F24 disposals/returns/adjustments; F25 asset purchase links without duplicate GL. F26 and later remain outside this request.

## F16 publication
Source68afc4b was committed/pushed separately. Fresh-runner [CI43445524244](https://github.com/TalhanAhmad/ERP-SYSTEM/actions/runs/43445524244) passed, including all34 additive migrations,219 unit/355 integration/35 browser cases, typing/lint, both builds and docs. Draft [PR #3](https://github.com/TalhanAhmad/ERP-SYSTEM/pull/3) tracks this new scope; no merge requested for this branch.

## F17 evidence
See [F17](planning/days/F17.md). Supplier payment/advance/application/credit/refund and correction workflows retain original cost and cash history. Thirteen supplier database checks plus three supplier schema checks passed; combined96-case bill/invoice/customer regression passed. Chromium form-to-post, paid credit and refund journey passed4.1s; no-store/version/current-access boundaries retained. Test schema36 additive migrations;89 concrete API paths. Source push and CI result are recorded only after observation.

## F17 publication
Source1ac3ba74294f784b0fcba465a76b3b1c5479ce49 was separately committed/pushed. [CI43447137270](https://github.com/TalhanAhmad/ERP-SYSTEM/actions/runs/43447137270) passed fresh36 migrations,222 unit/368 integration/36 Chromium checks (626 distinct), both builds, typing/lint and docs. Browser suite2.7 minutes. The current draft PR remains unmerged.

## F18 evidence
See [F18](planning/days/F18.md) and [tax accounting rules](accounting/taxes.md). Owner-reviewed effective-dated policy, exact tax/net posting and credit splits, actual snapshots, evidenced withholding in settlement and pre-tax replay compatibility implemented. Twelve tax integration checks passed7.62s;225 unit cases passed. New Chromium policy/source/withholding/PDF/access journey passed5.5s. Test schema43 additive migrations;91 concrete finance API paths. Full backend regression380 passed114.77s and the Supabase-mode build passed. A final defensive scalar/empty-input digest refinement and explicit manual-tax-control denial were checked separately; publication/CI evidence follows after observation.

## F18 publication and CI correction
Sourceb96f38d8a3c0b83a6ca6b16fcb729ea9d16dff6f was separately committed/pushed. CI43451766113 passed fresh43 migrations,225 unit and380 backend checks, then36 of37 browser cases. The existing invoice UI test expected the old “Invoice total” preview label; the accurate tax-aware label is “Rounded lines less discounts.” Updated that assertion without changing the amount expectation. The full invoice edit/lost-response/post/private-download journey then passed locally4.0s. Publishing this targeted test/report correction before F19; exact-source CI is pending.

## F18 final CI
Corrected head42f9ebb3a8ebe5359e77d05aacc776b488b9c838 passed [CI43455396870](https://github.com/TalhanAhmad/ERP-SYSTEM/actions/runs/43455396870):43 fresh migrations,225 unit/380 integration/37 Chromium cases (642 distinct), both builds, type/lint and docs. This confirms the updated preview assertion and all prior browser flows.

## F19 evidence
See [F19](planning/days/F19.md) and [private evidence/runbook](accounting/evidence.md). Fourteen source/security/operator checks plus three validation/CSP cases passed;6MiB real browser upload-to-signed-scan-to-private-download journey passed5.6s. Fake scanner/storage exist only in isolated tests; no production clean fallback. Test schema47,97 finance API paths. Full regression/publication evidence follows after observation.

## F19 final local verification
All660 distinct checks passed:228 unit,394 PostgreSQL integration (118.48s),38 Chromium browser (2.3m). Type/lint, local and Supabase-mode production builds,97-path API/local links, Word XML/relationships/private-value scan and all47 applied migration checksums passed. The full browser run preserved original ERP/finance journeys alongside private evidence. Publishing F19 separately; fresh-runner CI follows.

## F19 publication
Source32d8614 passed [CI43459582746](https://github.com/TalhanAhmad/ERP-SYSTEM/actions/runs/43459582746):660 checks,47 fresh migrations, both builds, type/lint/docs.

## F20 verification
See [F20](planning/days/F20.md). Migration48 rehearsed/deployed only to synthetic test database;12 backend +3 unit cases passed. Actual Chromium form-to-post/cash exclusion/reversal journey passed. Local production build/type/lint and103-path docs passed. Publishing this milestone separately before F21. No hosted finance changes.

## F20 publication
Sourcee865b55e249f94de29b8764f5252b9c193e11ec4 passed [CI43463973411](https://github.com/TalhanAhmad/ERP-SYSTEM/actions/runs/43463973411).

## F21 verification
See [F21](planning/days/F21.md). Full416 PostgreSQL checks (134.82s),234 unit, new Chromium capital-to-contributor-register journey (3.6s), typing/lint and both builds passed. Ten funding-specific cases include founder-paid AP, dated caps/reversal and separate contributor columns. Additive49/50 preserve prior migration checksums;103 API paths. Publishing this milestone separately before F22. No hosted finance changes.
