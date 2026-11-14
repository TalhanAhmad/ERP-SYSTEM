export const fundingKinds = [
  "CAPITAL_CONTRIBUTION",
  "CAPITAL_RETURN",
  "DISTRIBUTION",
  "NONCASH_CAPITAL",
  "FOUNDER_OUTLAY",
  "FOUNDER_BILL_SETTLEMENT",
  "FOUNDER_REIMBURSEMENT",
] as const;
export const movementKinds = ["TRANSFER", ...fundingKinds] as const;
