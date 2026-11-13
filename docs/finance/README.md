# Encova Finance

A restricted PKR accounting extension to the existing Encova Workspace. The supplied document describes the target system; it does not describe current functionality.

Start with [progress](progress.md), [repository assessment](repository-assessment.md), [decisions](decisions.md), and [the 48 milestones](planning/milestones.md). The original ERP roadmap remains separate.

F01–F11 are implemented and locally accepted: ownership/setup, exact amounts, manual journal lifecycle, core fixture, registers/drawers, parties/cash mappings and earned/deferred invoice backend. [F11 delivery report](delivery-F11.md) and [exact verification](testing/F11-results.md) distinguish this backend from F12 editor/PDF and later payments/statements/closing. Prior [F06–F10 report](delivery-F06-F10.md) remains historical evidence. No hosted finance migration/grant, real seed or launch occurred.

Requirements: [converted source](specification.md), [scope](product/scope.md), [permissions](product/permissions.md), [screens](product/screens.md). Design: [architecture](architecture/overview.md), [schema](database/schema.md), [posting rules](accounting/posting-rules.md), [API](api/contracts.md). Verification: [acceptance](testing/acceptance.md), [fixtures](testing/fixtures.md), [results](testing/results.md). Operations: [setup](operations/setup.md), [ownership/recovery](operations/ownership.md), [deployment](operations/deployment.md), [backup/restore](operations/backup-restore.md).
