export const bankMatchErrors: Record<string, string> = {
  FINANCE_MATCHED_CASH:
    "Resolve the original cash entry’s bank matches before posting its reversal. A new actual refund/payment uses its normal reviewed workflow.",
  FINANCE_MATCHED_STATEMENT:
    "Unmatch the statement’s active allocations before voiding its retained source.",
};
