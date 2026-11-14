# Reviewed bank/cash statement CSV evidence (F30)

## Bounded retained source

Imports describe existing statement evidence and never execute bank transactions, post GL, recognize income/expense, automatically match cash or declare reconciliation complete. Every account maps to an existing PKR bank/cash master; its original GL account ID is frozen with the retained source. No online banking credentials are requested or stored.

The exact initial file limit is5,000,000 bytes, with1–5,000 data records, at most50 columns,4,096 characters per raw field and up to25 preamble records before the chosen header. UTF-8 BOM, CRLF, escaped quotes, quoted commas and embedded newlines are supported. Binary/control characters, malformed quoting, ragged records and invalid encoding are rejected. Blank records are ignored; source record numbers count nonempty CSV records rather than physical quoted newlines. Zero-activity reconciliation does not require manufacturing a zero cash transaction; CSV transaction imports require at least one actual movement record.

[Vercel documents a4.5 MB function payload limit](https://vercel.com/docs/functions/limitations). Files therefore transfer in at most3 private requests with at most2MiB of raw bytes each. Canonical base64 JSON stays below3,000,000 bytes per transport request; the normal application JSON limit remains256KiB. Server previews are bounded to25 mapped records,20 original sample records,200 characters per sample cell and100 per displayed header. Full internal source/duplicate snapshots are not returned by ordinary detail APIs.

Original CSV bytes are retained as private structured import input in PostgreSQL, with immutable chunk identities/hashes. They are not public downloadable files or general PDF/image attachments; the F19 evidence-storage/scanner workflow remains separate. File/row retention policy and any future archival belong in the owner release review. No live file or hosted storage configuration was created.

## Explicit column and money interpretation

Choose the header/preamble offset, bank value-date column and explicit ISO YYYY-MM-DD, DD/MM/YYYY or MM/DD/YYYY format. Dates must be real Gregorian dates0001–9999 and every mapped record must fall within the stated statement range. Value dates are preserved independently of accounting posting dates; importing evidence does not create a future-dated journal.

Money uses one signed amount column with an explicit positive-money-in/out convention, or separate positive money-out and money-in columns. Correct comma thousands and dot decimals are supported, including signed/parenthesized negatives for the signed mode. Amounts use exact paisa and never floating-point arithmetic. Separate columns cannot both be positive; zero movement records are rejected. Description/reference columns are optional and distinct from other mapped columns; their normalized retained limits are1,000/200 characters. Source bytes and record references remain available for forensic reconstruction.

Opening and closing statement balances are exact signed PKR values; overdraft balances are supported. Preview displays money in, money out and closing minus(opening+in−out). Confirmation requires the complete equation to be zero. This validates source completeness, not the posted-bank reconciliation equation of F32. Aggregated flows support up to5,000 maximum-sized rows without losing paisa.

## Current review and duplicate evidence

The application reconstructs the actual immutable bytes, verifies byte size/SHA-256 and derives normalized rows on the server. Clients cannot supply normalized rows, fingerprints or trusted totals. Checked SQL independently verifies current actor/grant/session, source hash and original cash mapping, strict normalized schema, date placement, exact arithmetic, duplicate evidence, row digest and frozen header/line snapshots. Server CSV parsing is the trusted conversion boundary; the database does not run an unbounded character-by-character CSV parser.

Fingerprinting includes the bank/cash identity, value date, direction, exact amount and normalized reference/description. The index is intentionally nonunique. Equal legitimate records inside a file and potential cross-file duplicates are retained separately. Candidates require explicit record acknowledgements and a review reason; no record is silently deleted or automatically matched merely because an amount/date agrees. Duplicate evidence groups fingerprints before looking up prior rows, retains counts/digests and at most3 sample links/peer records per candidate, and binds the preview basis. New evidence between preview and confirmation requires a new review.

Exact same-file/account re-imports return the retained batch, including concurrent imports from independent selected uploaders. A racing different mapping or stated total conflicts rather than overwriting history. Statement account, file hash, import key, parser version, dates, opening/closing totals, source record numbers, fingerprints and row digest remain retained. File-hash identity is not a second cash transaction.

## Scoped transport and corrections

Reservation requires fresh current password/hosted authenticator proof and permanent scoped idempotency. It issues a random5-minute byte-only capability; only its digest/auth time are stored. Current uploader, current finance access, Origin/CSRF, exact chunk size/index/hash and a separate transport rate limit are checked for every transfer. This capability cannot read or import. Authenticated reserve retries rotate it, retaining valid immutable chunks; plaintext capability/password/code never enters a receipt or audit. Credentials/capabilities are held transiently for the request/transport, not in saved drafts or URLs.

Preview is an authorized read with Origin/CSRF and consumes no posting proof. Import, cancellation and void require fresh verification, a current version, a permanent key and the standard sensitive-write rate limit. Unknown processing errors exclude raw CSV, SQL parameters and provider sessions.

Imported headers, rows and original bytes cannot be edited or deleted. Void retains the original source and reason. A corrected import explicitly links the latest voided same-file/account source, with a unique replacement chain and no forks. Original/replacement links remain visible. F31/F32 add matching/reconciliation locks before matched/finalized evidence may be voided. Reusing a previously imported file for a different interpretation requires reviewing/correcting its retained source; it is not a silent new import.

## Access, verification and deployment

Current ACTIVE explicitly selected Super Admin access is required for all sources/options/previews/balances. Uncommitted stages are private to their uploader; completed statements are restricted company finance records. Project management alone grants nothing. Runtime roles have SELECT and checked interfaces only; direct writes, internal helpers, sequences and Data API execution are denied. Responses are private/no-store, and initial forms remain disabled until hydration with POST fallbacks to keep credentials out of URLs.

Migration64 passed syntax and functional transaction rollback rehearsals before guarded encova_test apply. The functional rehearsal found an ambiguous SQL alias; corrected it before applying64. Focused26 checks passed, including a4,780,034-byte/5,000-record file through bounded HTTP transport, last-page completeness and bounded preview responses. Final full-suite/build/report results are recorded in the milestone tracker. Finance remains disabled live; no hosted migration, grant, bank statement or real transaction was created.
