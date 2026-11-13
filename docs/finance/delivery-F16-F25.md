# Finance F16–F25 delivery tracker

Requested scope: continue from merged F15 through F25; test and push each milestone separately. Branch finance/f16-f25 starts at main c56cc78. This tracker records actual completed work and pending work without treating the specification as an instruction to launch finance.

## Status
F16 implemented and locally verified; publication checks underway. F17–F25 pending implementation. Hosted finance remains disabled, without hosted schema changes, owner grants or financial seeds. No real tax, funding, investment or depreciation policy has been selected.

## F16 evidence
Bills and immediate paid expenses, exact cost/project splits, duplicate supplier reference protection and explicit same-amount review, versioned fresh-auth commands, immutable source/journal/AP events, supplier snapshots, current access and private audit. See [F16](planning/days/F16.md).

DDL rollback rehearsal and additive migration34 passed on isolated synthetic encova_test. Focused bill/invoice/customer80 passed; dedicated bill9 plus schema3 and one Chromium journey passed. Earlier unchanged unit suite216 passed. Type/lint/local production build and concrete64-path API documentation checks passed. Full backend regression passed355 cases; existing unit216 plus bill unit3 passed219 distinct unit cases. Focused browser bill journey passed1; prior34 browser cases will be rerun in final regression. Supabase-mode production build also passed using configuration fixtures only. Publication/CI evidence follows when observed.

## Pending milestones
F17 supplier settlements; F18 reviewed tax/withholding configuration; F19 private quarantine attachments; F20 cash/transfers; F21 capital/distributions/founder costs; F22 loans; F23 investment holdings/acquisition lots; F24 disposals/returns/adjustments; F25 asset purchase links without duplicate GL. F26 and later remain outside this request.
