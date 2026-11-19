import type { ExportReadiness } from "../reports/exports/types";
import type { ReportMetadata } from "../reports/service";
export type ClosePeriod = {
  id: string;
  name: string;
  version: number;
  state: "OPEN" | "CLOSED" | "VOID";
  startDate: string;
  endDate: string;
};
export type CloseChecklist = {
  ready: boolean;
  readiness: ExportReadiness;
  pendingDrafts: {
    total: number;
    sourceHash: string;
    counts: Record<string, number>;
    items: {
      id: string;
      kind: string;
      reference: string;
      postingDate: string;
      version: number;
    }[];
  };
  openReviewIssueCount: number;
  reviewIssues: CloseIssue[];
  priorOpenPeriods: number;
  manualReviewRequired: boolean;
  manualReviewScope: string;
  postingReviewEvidence?: string;
  adjustmentReviewEvidence?: string;
  postingFailuresReviewed?: boolean;
  pendingAdjustmentsReviewed?: boolean;
};
export type ClosePreview = {
  period: ClosePeriod;
  canManage: boolean;
  checklist: CloseChecklist;
  basisHash: string;
  reportRows: Record<string, number>;
};
export type CloseItem = {
  id: string;
  sequence: number;
  state: "CLOSED" | "REOPENED";
  version: number;
  closedAt: string;
  closedById: string;
  reopenedAt: string | null;
  reopenedById: string | null;
  snapshotHash: string;
  reason: string;
  reopenReason: string | null;
};
export type CloseDetail = CloseItem & {
  periodId: string;
  period: ClosePeriod;
  canManage: boolean;
  startDate: string;
  endDate: string;
  basisHash: string;
  checklist: CloseChecklist;
  reportRows: Record<string, number>;
  postingReviewEvidence: string;
  adjustmentReviewEvidence: string;
};
export type CloseIssue = {
  id: string;
  periodId: string;
  kind: "POSTING_FAILURE" | "PENDING_ADJUSTMENT";
  description: string;
  evidence: string;
  state: "OPEN" | "RESOLVED";
  version: number;
  createdAt: string;
  createdById: string;
  resolvedAt: string | null;
  resolvedById: string | null;
  resolution: string | null;
};
export type ClosePaging<T> = {
  period: ClosePeriod;
  canManage: boolean;
  items: T[];
  total: number;
  page: number;
  pages: number;
};
export type CloseReport = {
  periodCloseId: string;
  closeState: string;
  closeSnapshotHash: string;
  metadata: ReportMetadata;
  summary: Record<string, unknown>;
  items: Record<string, unknown>[];
  total: number;
  page: number;
  pages: number;
};
