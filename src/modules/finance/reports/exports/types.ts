import type { ReportMetadata } from "../service";
import type { ExportRequest } from "./schemas";
export type ExportReadiness = {
  finalEligible: boolean;
  scope: string;
  [key: string]: unknown;
};
export type ExportSnapshot = {
  schemaVersion: 1;
  periodClose?: {
    id: string;
    sequence: number;
    snapshotHash: string;
    closedAt: string;
  };
  reportType: ExportRequest["reportType"];
  filters: Record<string, unknown>;
  mode: "REVIEW" | "FINAL";
  readiness: ExportReadiness;
  report: {
    metadata: ReportMetadata;
    items: Record<string, unknown>[];
    [key: string]: unknown;
  };
  rowCount: number;
  frozen: true;
};
export type ExportItem = {
  id: string;
  reportType: ExportRequest["reportType"];
  mode: "REVIEW" | "FINAL";
  state: "QUEUED" | "RUNNING" | "READY" | "FAILED" | "CANCELLED" | "SUPERSEDED";
  version: number;
  attempts: number;
  createdAt: string;
  expiresAt: string;
  errorCode: string | null;
  snapshotHash: string | null;
  rowCount: number | null;
};
export type ExportDetail = ExportItem & {
  requesterId: string;
  filters: Record<string, unknown>;
  reason: string;
  expired: boolean;
  canMutate: boolean;
  page: number;
  pages: number;
  readiness: ExportReadiness | null;
  failureDetails: ExportReadiness | null;
  metadata: ReportMetadata | null;
  summary: Record<string, unknown> | null;
  items: Record<string, unknown>[];
  csvHash: string | null;
  pdfHash: string | null;
  supersedeReason: string | null;
};
export type ExportRegister = {
  items: ExportItem[];
  page: number;
  pages: number;
  total: number;
};
