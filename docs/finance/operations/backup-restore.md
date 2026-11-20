# Finance backup, restore and migration recovery

F46 uses disposable local PostgreSQL17 clusters and populated financial sources. It never restores over the source, resets an existing target, or contacts a hosted database. [Recorded evidence](../review/recovery-evidence.json) covers both the nine-source acceptance books and populated opening/recognition/recurring records. Synthetic evidence is not a hosted backup policy or recovery-time commitment.

## Reproduce the engineering drill

Use Node24, the locked pnpm version and matching PostgreSQL17 pg_dump/pg_restore. Set DATABASE_URL, DIRECT_URL and TEST_DATABASE_URL explicitly to the dedicated loopback encova_test. Run `pnpm exec vitest run tests/integration/finance-acceptance.test.ts tests/integration/finance-opening.test.ts`. Those tests create their own separate PostgreSQL clusters, migrate them from zero, populate actual checked application workflows, restore into newly generated database names, verify and discard their owned clusters. The source dedicated shared test database is not restored or reset.

The reusable [owned recovery helper](../../../scripts/finance/owned-recovery.ts) requires the real data_directory to match a caller-owned `.local/finance/acceptance-UUID`, `opening-UUID`, `closing-browser-UUID` or `recovery-UUID`. Hosted URLs, non-encova_test source names, unowned directories and empty journals are rejected. It never accepts a caller-supplied restore target or drops an existing database. pg_dump uses custom format and preserves privileges; pg_restore stops on error. Global roles must already exist in the owned cluster. Provider Auth identity administration and global role provisioning are separate from this logical public-schema drill.

## What is compared

Every public table: exact sorted row representation, row count and SHA-256, including migration receipts/checksums, posted journal/subledger events, source identities, opening original text/hash, recurring attempts, recognition, private statement bytes and report CSV/PDF bytes. Compare source fingerprints again after the drill to reject concurrent source changes.

Every public constraint/validation flag, index, security-definer function definition, function execute ACL, relation ACL, RLS/forced-RLS flag, policy, default privilege and sequence value is compared. CHECK expressions normalize associative AND/OR grouping while retaining OR/NOT boundaries, atom text and all literals; tests distinguish changed operators, literals and arithmetic. Default-versus-explicit ACLs normalize into actual role/privilege/grant-option tuples. This handles PostgreSQL dump/reparse representation without ignoring permissions or constraints. Restored runtime/browser roles independently remain unable to write journal lines or execute raw bill cores.

The base drill creates a real reviewed PDF/CSV export and a bill attachment with a signed synthetic scanner attestation through the normal file service. Its object bytes are backed up separately, hash/size checked against FinanceFile, copied into a separate empty test object store, and verified against restored metadata. The cutover drill retains original UTF-8 opening bytes/hash and actual recognition/recurring history. External object backup is required when retained CLEAN/QUARANTINED objects exist; metadata alone is insufficient.

Artifacts remain ignored under `.local/recovery/finance/UUID`: directory0700, dump/object/evidence/comparison files0600. Version control receives only synthetic counts/totals/hashes. Do not publish dumps, cookies, scan-authority secrets or private original attachments. Retention/expiry of local diagnostic artifacts is an operator decision.

## Migration failure and rollback

The [rollback rehearsal helper](../../../scripts/finance/rehearse-migration.ts) removes only the explicit outer transaction wrapper and rejects extra top-level COMMIT/ROLLBACK/END/START/PREPARE TRANSACTION. It lexes quoted bodies and nested comments rather than mistaking PL/pgSQL BEGIN for a transaction wrapper. An actual additive table/data/function rehearsal and an intentionally faulted division-by-zero migration both roll back; full source fingerprints remain unchanged. Additive84 also passed an actual rehearsal before test application. Prior applied migration SQL is immutable.

If migration execution fails, keep finance disabled and stop writes. Inspect the private migration receipt/error, actual committed objects and source checksum. For a genuinely rolled-back migration fix the unapplied candidate and repeat in a clean owned database. If a transaction committed but its receipt failed, reconcile only after independently proving the complete intended schema and exact checksum; do not blindly mark failed SQL applied. Prefer a reviewed additive correction. A source rollback means deploying compatible prior application code with finance disabled; it does not mean deleting immutable financial tables/journals.

## Hosted prerequisites still requiring decisions

Choose the actual Supabase backup/PITR plan, off-site encrypted copy, backup frequency, retention, recovery-point/recovery-time targets, responsible operator and drill cadence. Include private Storage objects and scanner authorities; database dumps do not contain bucket bytes. Preserve global role grants, provider Auth identity mappings, deployment environment and secrets through a separate protected process. Rehearse the actual staging provider restore into a new isolated project and independently verify it before production adoption. No hosted finance migration, real import, live grant, paid plan change or activation was performed here.
