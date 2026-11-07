# ADR-001: New modular monolith

Date: 2026-11-07 (Asia/Karachi)
Status: accepted for foundation preparation

Evidence: local folder is empty; remote returned no refs. There is no code or real data to migrate.

Decision: use the workspace root as the repository root and the specification's Next.js/TypeScript/PostgreSQL modular monolith. Preserve the original document. Isolate temporary downloaded tooling outside the repository.

Alternatives: reuse an existing application (none supplied); split frontend/backend (unnecessary complexity); static demo (does not meet persistence or authorization requirements).

Consequences: production requires a Node host, PostgreSQL, SMTP and a separately scheduled worker. Docker/PostgreSQL availability and Git author identity remain prerequisites for their respective verification/publication steps.
