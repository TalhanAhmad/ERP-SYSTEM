export type Schedule = {
  id: string;
  name: string;
  kind: "BILL" | "JOURNAL" | "DEPRECIATION";
  template: Record<string, unknown>;
  startMonth: string;
  endMonth: string | null;
  day: number;
  evidence: string;
  active: boolean;
  version: number;
  createdAt: string;
};
export type RecurringRun = {
  id: string;
  scheduleId: string;
  month: string;
  postingDate: string;
  state: "QUEUED" | "RUNNING" | "READY" | "FAILED" | "CANCELLED";
  version: number;
  attempts: number;
  budget: number;
  sourceId: string | null;
  sourceType: "BILL" | "JOURNAL" | "ASSET_MOVEMENT" | null;
  errorCode: string | null;
  createdAt: string;
  name?: string;
  kind?: string;
};
export type Attempt = {
  id: string;
  attempt: number;
  startedAt: string;
  finishedAt: string | null;
  outcome: string;
  errorCode: string | null;
};
export type Recognition = {
  id: string;
  invoiceLineId: string;
  postingDate: string;
  amount: string;
  description: string;
  evidence: string;
  state: "DRAFT" | "POSTED" | "REVERSED" | "VOIDED";
  version: number;
  createdById: string;
  postedById: string | null;
  postedAt: string | null;
  journalId: string | null;
  reversalJournalId: string | null;
  reversalDate: string | null;
  createdAt: string;
};
export type CreditReview = {
  id: string;
  customerDocumentId: string | null;
  supplierDocumentId: string | null;
  offsetAccountId: string;
  basisHash: string;
  evidence: string;
  createdById: string;
  createdAt: string;
};
export type AutomationPaging<T> = {
  items: T[];
  total: number;
  page: number;
  pages: number;
  canManage: boolean;
};
export type AutomationMode =
  | "SCHEDULES"
  | "RUNS"
  | "RECOGNITIONS"
  | "SCHEDULE"
  | "RUN"
  | "RECOGNITION"
  | "DEFERRED_OPTIONS"
  | "ASSET_OPTIONS"
  | "EQUITY_OPTIONS"
  | "CREDIT_REVIEWS"
  | "CREDIT_STATUS";
