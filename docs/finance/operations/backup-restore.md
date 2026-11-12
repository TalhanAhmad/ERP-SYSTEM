# Finance backup and restore — pending

Existing ERP database/object restore evidence predates the finance migration and does not establish financial recoverability. Rehearse schema 18 and future ledger migrations into an isolated database; compare constraints, financial journal/subledger totals, source links and private attachment checksums. Preserve encrypted transport and operator-only artifacts. Never restore over the live source as a test.

Auth/PITR/off-site retention and finance evidence retention remain decisions. F46 requires recorded financial migration/restore/rollback evidence before release.
