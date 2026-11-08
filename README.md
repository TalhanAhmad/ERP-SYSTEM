# ERP-SYSTEM

Encova Workspace: a Next.js / PostgreSQL internal work platform.

**Initial implementation; the full specification and production acceptance are not complete.**

Selected stack: **Next.js + TypeScript + Tailwind + Supabase PostgreSQL/Auth/Storage + Prisma + Vercel**. See [deployment and cutover](docs/operations/deployment.md) and [the architecture decision](docs/decisions/ADR-002-supabase-vercel.md). Personal testing demo: https://encova-workspace.vercel.app. The hosted app uses Supabase Auth and PostgreSQL; local compatibility still uses Better Auth.

Working modules include invitation-based accounts with administrator resend/revoke, projects, task assignments/submissions/reviews, attendance, leave/corrections, daily reports, notifications, private per-revision file attachments, monitored attendance jobs and audit records. All displayed work records come from PostgreSQL; attached bytes live in private Supabase Storage. See [file limits and access](docs/operations/files.md).

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

Node 24 LTS and pnpm 12.18.0 are required. Use synthetic data during development. The hosted deployment is for personal testing; no real employee-data migration or company production acceptance has been performed.

Super admins can use Operations for job progress and audited retries. The daily attendance schedule is registered; first natural execution is pending observation. See [job operations](docs/operations/jobs.md).
