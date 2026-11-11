# Acceptance strategy

F01–F03: prove disabled-by-default runtime configuration, every existing role denied unless explicitly selected/current/active, anonymous HTTP denial, safe/minimal DTOs, no-store responses, stale-role/status and revocation checks, lock lifetime, unique grant/revocation/FK constraints, runtime read-only grants, immutable audit and Data API denial. Rehearse setup replay without permission widening. Run the full existing ERP regression before publishing.

F04 onward: prove owner bootstrap/transfer/last-owner and takeover protections, step-up MFA, posted journal balance/immutability, duplicate/concurrent posting, period races, settlement caps, dated reports, advance/deferred recognition, asset/investment limits, attachments/scanning, revocation and exports. Real PostgreSQL tests cannot be replaced by mocks. The final browser journey and accountant representative dataset remain required.
