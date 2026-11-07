# Work log

Date: 2026-11-07, Asia/Karachi. Append meaningful checkpoints; do not rewrite failures as successes.

| Step | Action | Evidence / outcome |
| --- | --- | --- |
| 001 | Inspect workspace | Empty directory; no application, Git repository or workspace AGENTS.md. |
| 002 | Read supplied DOCX | Extracted all paragraphs with Python stdlib ZIP/XML; original and text preserved under docs/source/. |
| 003 | Analyze requirements | Recorded scope, architecture, security risks, policy questions and acceptance gates in product/analysis.md. |
| 004 | Inspect remote | git ls-remote completed successfully with no advertised refs. |
| 005 | Inspect development tools | node, pnpm, docker, psql, postgres, brew and gh absent from PATH; git and Python present. |
| 006 | Inspect Git identity | user.name and user.email unset; requested author information. |
| 007 | Clarify document pacing | Asked whether to build across milestones or follow daily approval; no answer recorded yet. |
| 008 | Recover Node runtime | Downloaded official Node 24.22.2 ARM64 distribution into /tmp/encova-toolchain; node --version succeeded. |
| 009 | Verify official framework requirements | Next.js installation, Prisma system requirements and Better Auth installation documentation reviewed. Dependency resolution still needs verification. |
| 010 | Create tracking documents | Added analysis, ADR, progress/daily records, setup and verification logs. |
| 011 | Record user clarification | User approved building across milestones and supplied commit email. Set repository-local author to Talha Ahmad / supplied email; no global Git identity changed. |
| 012 | Initialize repository | Created main branch and origin remote matching the user's URL; preserved original DOCX. |
| 013 | Resolve supported dependencies | Pinned Next 16.4.5, React 19.3.1, Better Auth 1.7.18, Prisma 7.10.1 and Node 24.22.2. Avoided npm's Prisma 8 release candidate because the auth adapter documents it as unsupported. |
| 014 | Resolve package installation policy | Explicitly allowlisted Prisma engines, esbuild and local PostgreSQL binary hydration scripts. No package-provided agent skills were adopted. |
| 015 | Add application foundation | Strict TypeScript, Next App Router, lint, unit/integration/browser test configurations, environment placeholders and local Compose configuration. |
| 016 | Recover database runtime | Added isolated embedded PostgreSQL development helper bound to loopback, with separate dev/test/restore databases; Docker remains unavailable. |
| 017 | Implement work management | Library sessions, active domain-user checks, closed public signup, invitations, projects/membership, tasks, immutable revisions and independent review. |
| 018 | Build usable screens | Added login/invitation forms, workspace layout, dashboard, project/member forms, task assignment/detail/review, notification and audit screens. Data comes from PostgreSQL; no mock dashboard records. |
| 019 | Verify initial checks | Schema and type checking passed. Initial lint found a plain internal link; corrected to Next Link. 67 initial unit cases passed. |
| 020 | Fix integration runner | Replaced an unavailable Vitest describe.sequential API; the suite is sequential by default. |
| 021 | Fix concurrency retry defect | Real concurrent submission test exposed PostgreSQL 40001 errors surfaced through raw-query P2010. Added structured error-code handling and bounded retries; all initial 17 integration tests passed. |
| 022 | Add server boundaries | Added server-only imports and startup environment validation. Separated identity schemas from database services so pure unit tests need no database environment. |
| 023 | Add browser checks | Downloaded Chromium, added isolated role sessions, multi-revision task journey and 360px checks. Initial mobile check passed; multi-user journey required locator/fixture investigation. |
| 024 | Implement company-day services | Added day-shift policies/assignments, snapshots, raw attendance events, leave reservations/decisions, corrections and daily reports with return snapshots. |
| 025 | Add company-day screens | Attendance, schedules, leave, corrections and daily report forms use the same server services/API. Demo policy is not silently activated. |
| 026 | Fix advisory lock query | Prisma could not deserialize PostgreSQL void lock results; cast the advisory-lock return to text. Attendance/leave/report suite then passed, bringing integration coverage to 27 cases. |
| 027 | Add reviewed database integrity migration | Added foreign keys, independent-assignee constraint, date/status checks, active leave uniqueness, attendance day/user integrity and immutable history triggers. |
| 028 | Add operational worker | Added atomic outbox leasing, SMTP delivery/retry, expiration cleanup and attendance reconciliation. Worker scheduling/deployment remains separate work. |
| 029 | Correct test orchestration | One browser rerun overlapped an integration database reset and lost its synthetic accounts. Subsequent integration and browser phases are run sequentially. No production data was involved. |
| 030 | Test constraints | New username CHECK rejected a two-character HR fixture; corrected it to hr.admin. Constraint failures were recorded rather than relaxing production validation. |
| 031 | Extend worker verification | Added competing-worker, failed-delivery and expired-lease tests. A lease test needs further verification; changed worker leases to use the database clock. |
| 032 | Add people security actions | Added role changes, session revocation, deactivation and a serialized last-active-admin guard. Dedicated verification still required. |
| 033 | Verify security actions | Added tests for HR escalation denial, last-admin demotion/deactivation protection and immediate session revocation. PostgreSQL suite now passes 32 cases. |
| 034 | Repair browser locators/navigation | Use role/name select locators and wait for task detail URL before capturing it. |
| 035 | Repair mobile overflow | Constrain panel/table minimum width; 360px dashboard and work views pass with actual task records. |
| 036 | Remove network-dependent font loading | External font import stalled document load; switched to installed/system fallbacks. |
| 037 | Preserve production login limits | Browser helper retries within the real auth rate-limit policy because all four synthetic role sessions share loopback. |
| 038 | Finish browser journey | Both browser tests pass: multi-role project/task/revision/review/denied-access journey and 360px controls/layout. |
| 039 | Verify dependencies | pnpm peers check: no conflicts. pnpm audit --prod: no known vulnerabilities reported. |
| 040 | Record delivery boundaries | Added explicit remaining-release backlog, setup/runbook, API coverage and SQL migration notes. Full specification remains incomplete. |
| 041 | Validate documentation export | All 60 records and local documentation links pass verification. Exported Encova_Progress_Report.docx, validated ZIP/XML parts, and confirmed readable text through macOS textutil. |
| 042 | Verify repository exclusions | .env, local database, node_modules, generated Prisma code, browser traces and build output are ignored. Only placeholders and intended source/docs are staged. |
| 043 | Commit implementation | Created local root commit a7dccbd with message first commit, on main. Commit includes source, migrations, tests and progress DOCX. |
| 044 | Attempt requested push | git push -u origin main failed: could not read Username for https://github.com with terminal prompts disabled. No remote update claimed. |
| 045 | Discover publication fallback | GitHub integration found as available but not installed/connected; offered it so the user can authenticate. Connection is not assumed. |
| 046 | Record publication blocker | Updated report, live progress and test evidence to show successful local commit and blocked push. No auto-review or permission rejection occurred; this is an authentication failure. |
| 047 | Start local preview | Started the development server on loopback port 3000; /login returned HTTP 200. |
| 048 | Create requested local super admin | Confirmed encova_dev had no super admin, then ran the transactional bootstrap using the user's supplied email and a generated password. Credentials were provided privately in chat and were not stored in source or documentation. |
| 049 | Verify administrator login | Signed in through the real auth HTTP endpoint and fetched /api/v1/me with the resulting session; confirmed SUPER_ADMIN. Only local development data changed. |
| 050 | Begin step-by-step blocker resolution | User requested solving outstanding work step by step. Started with GitHub authentication/publication; no additional feature scope was started. |
| 051 | Install isolated GitHub CLI | Downloaded official GitHub CLI 2.103.3 for macOS ARM64, verified its published SHA-256 digest, and installed it under ignored .local/tools/gh/. |
| 052 | Start browser authentication | Confirmed no existing GitHub CLI login and started GitHub's device authorization flow. User must complete sign-in in their browser; no passwords, access tokens or device codes are recorded in project documents. |
