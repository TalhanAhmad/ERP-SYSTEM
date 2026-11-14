export const fundingKinds = [
  "CAPITAL_CONTRIBUTION",
  "CAPITAL_RETURN",
  "DISTRIBUTION",
  "NONCASH_CAPITAL",
  "FOUNDER_OUTLAY",
  "FOUNDER_BILL_SETTLEMENT",
  "FOUNDER_REIMBURSEMENT",
] as const;
export const loanKinds = [
  "LOAN_DISBURSEMENT",
  "LOAN_REPAYMENT",
  "LOAN_INTEREST_ACCRUAL",
  "LOAN_INTEREST_SETTLEMENT",
  "LOAN_PRINCIPAL_INCREASE",
  "LOAN_PRINCIPAL_DECREASE",
] as const;
export const investmentKinds = ["INVESTMENT_ACQUISITION"] as const;
export const movementKinds = [
  "TRANSFER",
  ...fundingKinds,
  ...loanKinds,
  ...investmentKinds,
] as const;
