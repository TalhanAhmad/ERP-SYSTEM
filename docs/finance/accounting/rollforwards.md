# Posted roll-forward reporting — F37 in progress

Current implementation reconstructs opening before the start DATE, actual positive increases and absolute decreases within the inclusive range, and closing through cutoff. Project results, funding, loans, investments, assets and advances retain separate metrics. Company totals and individual opening/closing control diagnostics are calculated before display filters and25-row paging.

Funding includes cash and noncash postings without automatically reclassifying personal outlays as capital. Loan directions RECEIVED and ADVANCED keep principal and interest separate. Investments keep original cost, carrying, income receivable and six-place units separate; unlike units are excluded from company monetary totals. Assets use actual purchase/register allocations and dated effects, including every actual accumulated-depreciation control. Unassigned purchase cost stays an explicit source/control discrepancy. Project earned results exclude YEAR_CLOSE, keep deferred billing separate, and preserve company unassigned costs. Advances use actual dated pool events.

A protected posted-source viewer shows exact posted lines and entry totals and resolves the actual source workflow. Customer/supplier credits, applications and reversals are not guessed to be receipts/payments. Typed corrections retain an original-entry link. Linked financial pages and APIs recheck current finance access.

Additive74 implements the reports and source viewer. Additive75 preserves six-place unit precision in diagnostics; applied74 was not rewritten. The negative-unit recovery case uses an operator-only fault inside a rolled-back test transaction and introduces no public bypass.

Final F37 acceptance is pending. The checkpoint has17 passing focused PostgreSQL cases, existing unit checks and affected browser coverage; the complete regression, dedicated roll-forward browser journey and Supabase-shaped build remain to be completed. No final export, hosted finance migration, activation or company/accountant acceptance is claimed.
