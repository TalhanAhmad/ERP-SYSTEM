# ERP-SYSTEM

Encova Workspace: a Next.js / PostgreSQL internal work platform.

**Initial implementation; the full specification and production acceptance are not complete.**

Working modules include invitation-based accounts, projects, task assignments/submissions/reviews, attendance, leave/corrections, daily reports, notifications and audit records. All displayed work records come from PostgreSQL.

Start with [setup](docs/operations/setup.md), then follow [progress](docs/progress.md), the [step log](docs/work-log.md), [verification results](docs/testing/results.md) and [remaining release work](docs/planning/backlog.md).

The [original DOCX](docs/source/Encova_Workspace_Full_Build_Specification.docx) and [analysis](docs/product/analysis.md) are preserved. All 60 proposed milestone records exist; planned files and templates do not count as completed features or learning sessions.

```
pnpm install --frozen-lockfile
pnpm db:generate
# Configure .env and PostgreSQL; see setup.md.
pnpm db:migrate:deploy
pnpm bootstrap:admin
pnpm dev
```

Node 24 LTS and pnpm 12.18.0 are required. Use synthetic data during development. No production deployment or real employee-data migration has been performed.
