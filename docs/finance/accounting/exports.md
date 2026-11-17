# Authorized report exports — F38

## Snapshot and formats

`/finance/exports` prepares private CSV and printable PDF copies of general ledger, trial balance, profit/loss, balance sheet, direct cash flow, AR/AP ageing, six roll-forward views and budget variance. Report links preserve dates and display filters; pagination is deliberately excluded so every filtered row is exported. The UI uses named dates/accounts/project scope, not raw JSON. A reason and fresh password/hosted authenticator are required.

Capture runs against one canonical posted dataset under the financial writer/configuration locks. Company, PKR, posted accrual basis, inclusive dates, original filters, generation time, transaction snapshot, ledger cutoff/digest and report-specific policy/budget proofs are retained with rows and complete totals. Rows, totals and source JSON never change after capture. Later legitimate posting does not rewrite issued reports or freeze an entire live ledger. Exact monetary strings and six-place units never pass through floating-point conversions.

Both files show the same snapshot hash and readiness. CSV quotes text and neutralizes leading formula characters, including whitespace-prefixed formulas and leading tabs/newlines; genuine signed numeric amounts remain numeric. NUL text is replaced with U+FFFD. PDF embeds the bundled Noto font, wraps full values, repeats page/table headings and uses column bands with stable row numbers for wide reports. Every original column/value and full-company total is preserved. Diagnostic lists carry their original bounds/counts; the readiness scope is never reduced by display filters.

The bounded initial implementation accepts at most 2,000 filtered rows, 6MiB of canonical snapshot JSON and 3MiB per file. Oversize output fails; it never silently truncates rows. Narrow dates/search and request another copy. Snapshot rows/detail and register responses are paginated25. PDFs also stop at1,000 pages. F45 will measure larger-dataset performance rather than claiming untested capacity.

## Review versus final

REVIEW copies can be incomplete and explicitly say so. FINAL copies require complete company checks: balanced books and statement mapping, AR/AP controls, funding/loan/investment/asset/advance controls, deferred revenue, opening clearing, complete cash-flow component reviews and actual finalized bank reviews at the exact cutoff. Active banks and cash accounts with posted history remain relevant; archiving a used bank cannot hide it. Cash controls with posted history need a real cash master. No balancing amount, invented bank evidence or inferred review is introduced.

Final budget variance also requires the actual approved budget revision and available mappings; overspend is advisory. Budget id/revision/version/approval and incurred actuals remain in the snapshot. Final exports with a future cutoff or overlapping closed period are blocked; F39 must add the controlled period-close snapshot/reopen/supersession workflow. F34's older `finalExportEligible` field covers only presentation/books and is not the F38 full-company final gate.

## Current authorization and retained history

Current ACTIVE Super Admin plus an explicit active FinanceGrant is required at request, execution, completion and download. Jobs retain the exact original grant epoch; revocation/deletion and later regrant cannot resurrect that job. Requesters access their own exports. The current Finance Owner may review/download other requesters' exports only while the original requester remains authorized. Other selected administrators cannot inspect those files. HR, leads, members and ordinary workspace/operations DTOs receive no export amounts, filters or identifiers.

No public bucket or presigned download exists. The checked private API returns stored bytes with attachment disposition, private/no-store, nosniff and sandbox CSP; authorization is repeated after byte retrieval. Availability expires24 hours after request. Expiry is logical: immutable source/file proofs and bytes remain retained privately for audit; ordinary downloads and execution stop. Physical archive/retention policy remains an explicit operational decision, not a fabricated cleanup. READY snapshots can only gain a retained SUPERSEDED state through future controlled workflows; no current public supersede/delete action exists.

## Durable processing and recovery

Request/retry/cancel use permanent request receipts and fresh provider proof. QUEUED → RUNNING uses a60-second exclusive lease; at most3 attempts are allowed. Concurrent or stale workers cannot finish another lease. Capture is persisted before rendering; rendering retries reuse that exact captured source. A rejected FINAL that never captured an accepted source may capture corrected books on retry. Cancel cannot remove an issued file. Requests, capture proofs and completed file hashes are audited without raw snapshot/artifact contents in the audit payload.

Processing starts inline after the durable request. The existing scheduled worker privately resumes queued/expired-lease jobs only when finance is enabled, and exposes no export result in ordinary operations. `pnpm finance:exports` provides a private operator pass. Job state/errors are reviewed in the finance register; reload refreshes status. A failed request can be retried with current version, fresh verification and retained filters; exhausted/expired jobs require a new request. The Hobby daily schedule is a recovery pass, not a continuous processing SLA. Fonts are traced for both finance APIs and the internal scheduled route.

## Verification boundary

All examples/tests are synthetic. A separate owned ephemeral PostgreSQL17 database proves genuinely passing FINAL books without deleting the shared regression database's retained history. Actual earned income100.01 and incurred expense60.00 produce balanced160.01 movements and profit40.01; a real zero-activity bank review clears only its exact cutoff. Unregistered capitalized equipment blocks new FINAL copies. Current-role/grant epoch changes, private downloads, formula text, six-place units, all pages, immutable snapshots, leases, retries, expiry and row/byte bounds have dedicated tests. No hosted finance migration, live grant, real bank activity or human accountant acceptance is implied.
