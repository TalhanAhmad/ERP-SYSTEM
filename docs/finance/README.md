# Encova Finance

A restricted PKR accounting extension to the existing Encova Workspace. The supplied document describes the target system; it does not describe current functionality.

Start with [progress](progress.md), [repository assessment](repository-assessment.md), [decisions](decisions.md), and [the 48 milestones](planning/milestones.md). The original ERP roadmap remains separate.

Current engineering scope is F01–F25. [F16–F25 delivery](delivery-F16-F25.md) and its [Word report](Encova_F16-F25_Report.docx) record separate milestone commits, checks and remaining release work. Implemented sources include invoice/customer and purchase/supplier cycles, reviewed tax/evidence, cash/funding/loans, investment holdings/disposals/income/value changes and a purchase-linked asset register. F26 depreciation and later reporting/reconciliation remain outside this delivery. Finance remains disabled live; no real seeds, grants or hosted financial migration are performed.

Requirements: [converted source](specification.md), [scope](product/scope.md), [permissions](product/permissions.md), [screens](product/screens.md). Design: [architecture](architecture/overview.md), [schema](database/schema.md), [posting rules](accounting/posting-rules.md), [API](api/contracts.md). Verification: [acceptance](testing/acceptance.md), [fixtures](testing/fixtures.md), [results](testing/results.md). Operations: [setup](operations/setup.md), [ownership/recovery](operations/ownership.md), [deployment](operations/deployment.md), [backup/restore](operations/backup-restore.md).
