# Encova Finance

A restricted PKR accounting extension to the existing Encova Workspace. The supplied document describes the target system; it does not describe current functionality.

Start with [progress](progress.md), [repository assessment](repository-assessment.md), [decisions](decisions.md), and [the 48 milestones](planning/milestones.md). The original ERP roadmap remains separate.

F01–F15 are locally accepted: ownership/setup, exact ledger, invoice screens/private PDF, receipts/advances, credits/refunds and dated corrections. [F12–F15 delivery](delivery-F12-F15.md), [exact checks](testing/F12-F15-results.md) and [posting rules](accounting/customer-cycle.md) distinguish these working customer flows from F16 onward and a hosted finance launch. Separate milestone source pushes and final CI are recorded in the report. Finance remains disabled live; no real seeds, grants or hosted migration/deployment occurred.

Requirements: [converted source](specification.md), [scope](product/scope.md), [permissions](product/permissions.md), [screens](product/screens.md). Design: [architecture](architecture/overview.md), [schema](database/schema.md), [posting rules](accounting/posting-rules.md), [API](api/contracts.md). Verification: [acceptance](testing/acceptance.md), [fixtures](testing/fixtures.md), [results](testing/results.md). Operations: [setup](operations/setup.md), [ownership/recovery](operations/ownership.md), [deployment](operations/deployment.md), [backup/restore](operations/backup-restore.md).
