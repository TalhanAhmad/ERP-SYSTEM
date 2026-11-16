# Bank reconciliation (F32)

Finance remains disabled live. Current ACTIVE selected Super Admin only; all screens and APIs are private/no-store. A reviewed bank proof never posts cash or executes a transfer.

## Source and exact equation

Select one retained imported statement: its original bank/GL, range, file hash and closing balance define this source review. Do not merge overlapping imported files or label all files reconciled. Cash uses actual posted GL dates; bank evidence uses value dates. Allocation effectiveness is the later date, so later bank matching cannot silently erase a deposit outstanding at an earlier cutoff. GL closing includes all posted cash legs through the cutoff, including opening balances; opening/YEAR_CLOSE balances are not manufactured bank movements.

Closing statement balance + outstanding deposits − outstanding payments − posted GL bank balance = explained difference. Show unresolved bank receipts/payments separately; positive rows never disappear because opposite amounts net to zero. Finalization independently requires zero difference, all cash-outstanding documentation and no unresolved bank record. Bank fees/missing real cash require normal reviewed typed posting and explicit matching, never automatic reconciliation income/expense.

No-activity reviews have explicit dates, equal opening/closing bank balances and evidence, with no imported activity in the range. Their equation must still match actual books; no fake zero CSV row or editable GL opening balance is introduced.

## Review and retained corrections

CREATE captures a current server-derived draft proof. Notes update at most100 distinct rows per bounded request. Every outstanding cash entry needs a3–500-character explanation. A genuine cross-file duplicate needs explicit EXCLUDE_DUPLICATE, reason and a different same-bank imported peer with the exact fingerprint, already fully matched to actual cash by this cutoff. Retain the duplicate row and its original amount; never remove or automatically exclude it. Ordinary bank comments do not resolve activity.

Source history hashes and full independent validation detect new historical cash/matching or altered evidence. REFRESH explicitly captures current draft positions and clears its notes; previous review remains in audit history. VOID retains an unissued draft. FINALIZE captures company/PKR/basis/filters/date/generation metadata and the immutable source/notes snapshot. Later corrections require current Finance Owner REOPEN, latest affected cutoff first. Reopening retains/supersedes the issued snapshot. A replacement names the latest reopened/voided review and current version; chains cannot fork, even with equal transaction timestamps.

Finalized cutoffs block historical bank cash postings/reversals, original-date matching changes, original/peer source void, and new imports contradicting finalized no-activity evidence. Later actual activity remains available. A retained reconciliation freezes the bank’s original GL/currency/kind/masked identity, including an empty bank; display-name changes/archival are separate. F39 later supplies broader owner period closing controls; this milestone supplies bank-specific barriers only.

## Bounded private proof

Up to5,000 outstanding cash items and5,000 bank records per review; exceeding this bound gives an explicit earlier-cutoff/cutover review conflict. Reads return25 stable items, summary/hash and current basis status; full source/final JSON stays in private PostgreSQL. Notes/commands stay below ordinary request limits; no large client-claimed proof is accepted. Runtime has SELECT and three actor-checked interfaces; internal helpers/number sequence and Data API writes are denied. Source, row notes, financial audit and final snapshots are retained. Finalized notes cannot be rewritten. No existing GL scalar fields or prior migration checksums are changed.
