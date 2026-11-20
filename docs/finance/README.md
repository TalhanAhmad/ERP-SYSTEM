# Encova Finance

A restricted PKR accounting extension to the existing Encova Workspace. The supplied document describes the target system; it does not describe current functionality.

Start with [progress](progress.md), [repository assessment](repository-assessment.md), [decisions](decisions.md), and [the 48 milestones](planning/milestones.md). The original ERP roadmap remains separate.

F01–F40 are merged through PR7. F41–F46 are separately committed/pushed in [draft PR8](https://github.com/TalhanAhmad/ERP-SYSTEM/pull/8). F44 exact sourcebb14c49 passed [fresh CI44774304395](https://github.com/TalhanAhmad/ERP-SYSTEM/actions/runs/44774304395); later exact-source CI is tracked in progress. F45 combined browser/error recovery and F46 populated restore/rollback are locally verified. F47's [review workbook](review/reviewer-workbook.md) is prepared for Talha; actual human review and F48 launch remain pending. [Current delivery](delivery-F26-F48.md), [verification](testing/F26-F48-results.md), [Word report](Encova_F26-F48_Report.docx) and [owner pack](review/owner-review-pack.md) record evidence. Hosted finance stays disabled.

Requirements: [converted source](specification.md), [scope](product/scope.md), [permissions](product/permissions.md), [screens](product/screens.md). Design: [architecture](architecture/overview.md), [schema](database/schema.md), [posting rules](accounting/posting-rules.md), [API](api/contracts.md). Verification: [acceptance](testing/acceptance.md), [fixtures](testing/fixtures.md), [results](testing/results.md). Operations: [setup](operations/setup.md), [ownership/recovery](operations/ownership.md), [deployment](operations/deployment.md), [backup/restore](operations/backup-restore.md).
