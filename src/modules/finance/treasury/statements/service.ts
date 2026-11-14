import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";
import { Prisma } from "@/generated/prisma/client";
import { db } from "@/server/db";
import type { Actor } from "@/server/context";
import { AppError, invariant } from "@/server/errors";
import {
  requireFinanceEnabled,
  financeStatus,
  withFinanceAccess,
} from "../../access/policy";
import { consumeFinanceProof, type FinanceProof } from "../../access/reauth";
import {
  parseStatementCsv,
  mapStatementCsv,
  csvPreviewGrid,
  STATEMENT_CHUNK_BYTES,
} from "./csv";
import {
  statementReserveSchema,
  statementChunkSchema,
  statementPreviewSchema,
  statementImportSchema,
  statementActionSchema,
  statementBatchQuerySchema,
  statementLineQuerySchema,
} from "./schemas";
type Tx = Prisma.TransactionClient;
type CommandResult = {
  id?: string;
  number?: string;
  version?: number;
  uploadId?: string | null;
  batchId?: string | null;
  reused: boolean;
  retainedVoided?: boolean;
};
type Duplicate = {
  sourceRow: number;
  fingerprint: string;
  withinSourceCount: number;
  samplePeerRows: number[];
  existingCount: number;
  existingDigest: string;
  sampleLines: { id: string; batchId: string }[];
};
type Evaluation = {
  rowCount: number;
  receipts: string;
  payments: string;
  rowDigest: string;
  minValueDate: string;
  maxValueDate: string;
  duplicates: Duplicate[];
  difference: string;
  balanced: boolean;
  uploadVersion: number;
  basisHash: string;
};
const messages: Record<string, string> = {
  FINANCE_FORBIDDEN: "Finance access is unavailable.",
  FINANCE_REAUTH_REQUIRED: "Verify your password and authenticator again.",
  FINANCE_NOT_FOUND: "Statement source unavailable.",
  FINANCE_STALE_VERSION:
    "This statement source changed. Reload its preview before trying again.",
  FINANCE_IDEMPOTENCY_CONFLICT:
    "This request key was used for different statement input.",
  FINANCE_DUPLICATE:
    "This statement file or replacement was already recorded. Reload to review the retained source.",
  FINANCE_INVALID_INPUT: "Check the statement fields and exact values.",
  FINANCE_ACCOUNT_UNAVAILABLE:
    "Choose an active PKR bank/cash account with its original active cash mapping.",
  FINANCE_STATEMENT_MAPPING:
    "Choose valid distinct CSV columns and an explicit date/amount format.",
  FINANCE_STATEMENT_ROWS:
    "Check the bounded statement rows and exact dates/amounts.",
  FINANCE_STATEMENT_RANGE:
    "Every bank value date must fall inside the stated date range.",
  FINANCE_STATEMENT_FILE:
    "The complete file, byte size and SHA-256 must match the reserved CSV. Resume the same file or cancel and start again.",
  FINANCE_STATEMENT_SOURCE:
    "The retained file, rows, totals and source snapshot must agree.",
  FINANCE_STATEMENT_RETAINED:
    "Statement history is retained. Void an unmatched imported source to review a replacement.",
  FINANCE_STATEMENT_IMMUTABLE:
    "This source is retained and cannot be edited or uploaded again.",
  FINANCE_STATEMENT_UPLOAD_EXPIRED:
    "The scoped upload authorization expired or changed. Verify your credentials to resume the same file.",
  FINANCE_STATEMENT_CHUNK_CONFLICT:
    "A different chunk already occupies this position. Cancel this upload and reserve the correct file.",
  FINANCE_STATEMENT_RESERVATION:
    "An unfinished upload has different reserved metadata. Resume its original file or cancel it first.",
  FINANCE_STATEMENT_REPLACEMENT:
    "Choose the latest voided source for this same file and bank account; reviewed replacements cannot fork history.",
  FINANCE_STATEMENT_REIMPORT_CONFLICT:
    "This file already has an import with different reviewed mapping or totals. Review its retained source before correcting it.",
  FINANCE_STATEMENT_STALE_PREVIEW:
    "Statement or duplicate evidence changed. Review a new preview before importing.",
  FINANCE_STATEMENT_EQUATION:
    "Opening balance plus money in minus money out must equal the stated closing balance.",
  FINANCE_STATEMENT_DUPLICATES:
    "Review and explicitly acknowledge every potential duplicate source record; no rows are silently removed.",
};
const intentDigest = (token: string) =>
  createHash("sha256")
    .update("encova-statement-upload-v1:" + token)
    .digest("hex");
const sha = (bytes: Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");
const day = (d: Date) => d.toISOString().slice(0, 10);
const lock = async (tx: Tx) => {
  await tx.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock_shared(629815)`;
};
function databaseError(error: unknown): never {
  const cause = (
      error as {
        meta?: {
          driverAdapterError?: {
            cause?: { originalCode?: string; originalMessage?: string };
          };
        };
      }
    )?.meta?.driverAdapterError?.cause,
    code = cause?.originalMessage;
  if (code && messages[code])
    throw new AppError(
      code,
      messages[code],
      code === "FINANCE_NOT_FOUND"
        ? 404
        : [
              "FINANCE_FORBIDDEN",
              "FINANCE_REAUTH_REQUIRED",
              "FINANCE_STATEMENT_UPLOAD_EXPIRED",
            ].includes(code)
          ? 403
          : code === "FINANCE_INVALID_INPUT"
            ? 422
            : 409,
    );
  // Never include raw CSV, upload capabilities, SQL parameters or provider sessions in errors/logs.
  throw new AppError(
    "FINANCE_STATEMENT_UNAVAILABLE",
    "Statement processing is unavailable. Retry with the same request key.",
    503,
  );
}
function key(value: string | null) {
  invariant(
    value && value.length >= 8 && value.length <= 128,
    "IDEMPOTENCY_REQUIRED",
    "Provide an Idempotency-Key of 8–128 characters.",
    400,
  );
  return value;
}
async function checked(
  actor: Pick<Actor, "id">,
  proof: FinanceProof,
  action: "RESERVE" | "IMPORT" | "CANCEL" | "VOID",
  input: Record<string, unknown>,
  requestKey: string,
  requestId = crypto.randomUUID(),
) {
  const evidence = consumeFinanceProof(
    proof,
    actor.id,
    "statements:" + action + ":" + requestKey,
  );
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return (
        await db.$queryRaw<
          { result: CommandResult }[]
        >`SELECT public.encova_finance_statement_command(${actor.id}::uuid,${evidence.provider},${evidence.sessionId},${evidence.verifiedAt}::timestamptz,${action},${JSON.stringify(input)}::jsonb,${requestKey},${requestId}::uuid) AS result`
      )[0].result;
    } catch (e) {
      const code = (
        e as {
          meta?: { driverAdapterError?: { cause?: { originalCode?: string } } };
        }
      )?.meta?.driverAdapterError?.cause?.originalCode;
      if (["40001", "40P01"].includes(code ?? "") && attempt < 2) continue;
      databaseError(e);
    }
  }
  throw new AppError(
    "CONCURRENT_CHANGE",
    "Concurrent statement change; retry.",
    409,
  );
}
const uploadSelect = {
  id: true,
  cashAccountId: true,
  glAccountId: true,
  fileName: true,
  byteSize: true,
  sha256: true,
  replacesId: true,
  resultBatchId: true,
  state: true,
  version: true,
  intentVerifiedAt: true,
  createdAt: true,
  cashAccount: { select: { name: true, maskedReference: true } },
  glAccount: { select: { code: true, name: true } },
  createdById: true,
  chunks: {
    select: { index: true, sha256: true },
    orderBy: { index: "asc" as const },
  },
} as const;
export async function statementUpload(actor: Pick<Actor, "id">, id: string) {
  return withFinanceAccess(actor, async (tx) => {
    z.uuid().parse(id);
    await lock(tx);
    const item = await tx.financeStatementUpload.findUnique({
      where: { id },
      select: uploadSelect,
    });
    invariant(item, "FINANCE_NOT_FOUND", "Statement upload unavailable.", 404);
    invariant(
      item.createdById === actor.id,
      "FINANCE_FORBIDDEN",
      "This pending upload is private to its uploader.",
      403,
    );
    const { intentVerifiedAt, ...data } = item;
    return {
      ...data,
      authorizedUntil: new Date(
        intentVerifiedAt.getTime() + 300000,
      ).toISOString(),
      expectedChunks: Math.ceil(item.byteSize / STATEMENT_CHUNK_BYTES),
      complete:
        item.chunks.length === Math.ceil(item.byteSize / STATEMENT_CHUNK_BYTES),
    };
  });
}
export async function reserveStatement(
  actor: Pick<Actor, "id">,
  proof: FinanceProof,
  input: unknown,
  requestKey: string | null,
  requestId = crypto.randomUUID(),
) {
  requireFinanceEnabled();
  await financeStatus(actor);
  const body = statementReserveSchema.parse(input),
    intent = randomBytes(32).toString("hex"),
    result = await checked(
      actor,
      proof,
      "RESERVE",
      { ...body, intentHash: intentDigest(intent) },
      key(requestKey),
      requestId,
    );
  if (result.batchId) {
    const batch = await statementBatch(actor, result.batchId);
    return {
      upload: null,
      batch: {
        id: batch.item.id,
        number: batch.item.number,
        state: batch.item.state,
        fileName: batch.item.fileName,
        cashAccountId: batch.item.cashAccountId,
      },
      intent: null,
      reused: true,
      retainedVoided: result.retainedVoided ?? false,
    };
  }
  invariant(
    result.uploadId,
    "FINANCE_STATEMENT_UNAVAILABLE",
    "Reserved upload unavailable.",
    503,
  );
  const upload = await statementUpload(actor, result.uploadId);
  if (upload.resultBatchId) {
    const batch = await statementBatch(actor, upload.resultBatchId);
    return {
      upload: null,
      batch: {
        id: batch.item.id,
        number: batch.item.number,
        state: batch.item.state,
        fileName: batch.item.fileName,
        cashAccountId: batch.item.cashAccountId,
      },
      intent: null,
      reused: true,
      retainedVoided: batch.item.state === "VOIDED",
    };
  }
  return {
    upload,
    batch: null,
    intent: upload.state === "UPLOADING" ? intent : null,
    reused: false,
    retainedVoided: false,
  };
}
export async function uploadStatementChunk(
  actor: Pick<Actor, "id">,
  id: string,
  input: unknown,
) {
  requireFinanceEnabled();
  await financeStatus(actor);
  z.uuid().parse(id);
  const { intent, ...body } = statementChunkSchema.parse(input);
  try {
    return (
      await db.$queryRaw<
        {
          result: {
            index: number;
            sha256: string;
            version: number;
            uploaded: boolean;
          };
        }[]
      >`SELECT public.encova_finance_statement_transport(${actor.id}::uuid,${JSON.stringify({ ...body, id, intentHash: intentDigest(intent) })}::jsonb) AS result`
    )[0].result;
  } catch (e) {
    databaseError(e);
  }
}
async function fileData<T>(
  actor: Pick<Actor, "id">,
  id: string,
  callback: (
    tx: Tx,
    upload: {
      id: string;
      state: string;
      version: number;
      cashAccountId: string;
      glAccountId: string;
      fileName: string;
      sha256: string;
      byteSize: number;
      replacesId: string | null;
    },
    grid: string[][],
  ) => Promise<T>,
) {
  return withFinanceAccess(actor, async (tx) => {
    z.uuid().parse(id);
    await lock(tx);
    const u = await tx.financeStatementUpload.findUnique({
      where: { id },
      include: { chunks: { orderBy: { index: "asc" } } },
    });
    invariant(u, "FINANCE_NOT_FOUND", "Statement upload unavailable.", 404);
    invariant(
      u.createdById === actor.id,
      "FINANCE_FORBIDDEN",
      "This source upload is private to its uploader.",
      403,
    );
    invariant(
      u.state !== "CANCELLED",
      "FINANCE_STATEMENT_IMMUTABLE",
      messages.FINANCE_STATEMENT_IMMUTABLE,
      409,
    );
    invariant(
      u.chunks.length === Math.ceil(u.byteSize / STATEMENT_CHUNK_BYTES) &&
        u.chunks.every(
          (c, i) =>
            c.index === i &&
            c.bytes.length ===
              Math.min(
                STATEMENT_CHUNK_BYTES,
                u.byteSize - i * STATEMENT_CHUNK_BYTES,
              ) &&
            sha(c.bytes) === c.sha256,
        ),
      "FINANCE_STATEMENT_FILE",
      messages.FINANCE_STATEMENT_FILE,
      409,
    );
    const bytes = Buffer.concat(u.chunks.map((c) => Buffer.from(c.bytes)));
    invariant(
      bytes.length === u.byteSize && sha(bytes) === u.sha256,
      "FINANCE_STATEMENT_FILE",
      messages.FINANCE_STATEMENT_FILE,
      409,
    );
    return callback(tx, u, parseStatementCsv(bytes));
  });
}
export async function statementGrid(
  actor: Pick<Actor, "id">,
  id: string,
  input: unknown = {},
) {
  return fileData(actor, id, async (_tx, u, grid) => {
    const { skipRows } = z
      .object({ skipRows: z.coerce.number().int().min(0).max(25).default(0) })
      .strict()
      .parse(input);
    return {
      uploadId: u.id,
      version: u.version,
      ...csvPreviewGrid(grid, skipRows),
    };
  });
}
export async function previewStatement(
  actor: Pick<Actor, "id">,
  id: string,
  input: unknown,
  pageInput: unknown = {},
) {
  return fileData(actor, id, async (tx, u, grid) => {
    const metadata = statementPreviewSchema.parse(input),
      q = statementLineQuerySchema.parse(pageInput),
      mapped = mapStatementCsv(grid, metadata.mapping);
    let evaluated: Evaluation;
    try {
      evaluated = (
        await tx.$queryRaw<
          { data: Evaluation }[]
        >`SELECT public.encova_finance_statement_preview(${actor.id}::uuid,${JSON.stringify({ id: u.id, metadata, rows: mapped.rows })}::jsonb) AS data`
      )[0].data;
    } catch (e) {
      return databaseError(e);
    }
    const pages = Math.max(1, Math.ceil(mapped.rows.length / 25)),
      page = Math.min(q.page, pages),
      rows = mapped.rows.slice((page - 1) * 25, page * 25),
      { duplicates, ...summary } = evaluated;
    return {
      ...summary,
      uploadId: u.id,
      mapping: mapped.mapping,
      metadata,
      page,
      pages,
      rows,
      duplicateCount: duplicates.length,
      duplicateRows: duplicates.map((d) => d.sourceRow),
      duplicateEvidence: duplicates.filter((d) =>
        rows.some((r) => r.sourceRow === d.sourceRow),
      ),
    };
  });
}
export async function importStatement(
  actor: Pick<Actor, "id">,
  proof: FinanceProof,
  id: string,
  input: unknown,
  requestKey: string | null,
  requestId = crypto.randomUUID(),
) {
  requireFinanceEnabled();
  await financeStatus(actor);
  z.uuid().parse(id);
  const body = statementImportSchema.parse(input),
    rows = await fileData(
      actor,
      id,
      async (_tx, _u, grid) => mapStatementCsv(grid, body.mapping).rows,
    );
  return checked(
    actor,
    proof,
    "IMPORT",
    { ...body, id, rows },
    key(requestKey),
    requestId,
  );
}
export async function statementAction(
  actor: Pick<Actor, "id">,
  proof: FinanceProof,
  action: "CANCEL" | "VOID",
  id: string,
  input: unknown,
  requestKey: string | null,
  requestId = crypto.randomUUID(),
) {
  requireFinanceEnabled();
  await financeStatus(actor);
  return checked(
    actor,
    proof,
    action,
    { ...statementActionSchema.parse(input), id: z.uuid().parse(id) },
    key(requestKey),
    requestId,
  );
}
const batchSelect = {
  id: true,
  number: true,
  uploadId: true,
  cashAccountId: true,
  glAccountId: true,
  sha256: true,
  importKey: true,
  parserVersion: true,
  mapping: true,
  startDate: true,
  endDate: true,
  openingBalance: true,
  closingBalance: true,
  receipts: true,
  payments: true,
  rowCount: true,
  rowDigest: true,
  duplicateReview: true,
  replacesId: true,
  state: true,
  version: true,
  createdAt: true,
  createdBy: { select: { displayName: true } },
  upload: { select: { fileName: true, byteSize: true } },
  cashAccount: { select: { name: true, maskedReference: true } },
  glAccount: { select: { code: true, name: true } },
  replaces: { select: { id: true, number: true, state: true } },
  replacedBy: { select: { id: true, number: true, state: true } },
} as const;
export async function statementBatch(
  actor: Pick<Actor, "id">,
  id: string,
  input: unknown = {},
) {
  return withFinanceAccess(actor, async (tx) => {
    z.uuid().parse(id);
    const q = statementLineQuerySchema.parse(input);
    await lock(tx);
    const b = await tx.financeStatementBatch.findUnique({
      where: { id },
      select: batchSelect,
    });
    invariant(
      b && b.state !== "DRAFT",
      "FINANCE_NOT_FOUND",
      "Statement batch unavailable.",
      404,
    );
    const pages = Math.max(1, Math.ceil(b.rowCount / 25)),
      page = Math.min(q.page, pages),
      lines = await tx.financeStatementLine.findMany({
        where: { batchId: id },
        orderBy: { sequence: "asc" },
        take: 25,
        skip: (page - 1) * 25,
      }),
      history = await tx.financeAuditEvent.findMany({
        where: { entityType: "FinanceStatementBatch", entityId: id },
        select: {
          id: true,
          action: true,
          reason: true,
          createdAt: true,
          actor: { select: { displayName: true } },
        },
        orderBy: [{ createdAt: "desc" }, { id: "asc" }],
        take: 50,
      }),
      counts = await tx.$queryRaw<
        { count: number }[]
      >`SELECT jsonb_array_length("duplicateSnapshot") AS count FROM "FinanceStatementBatch" WHERE id=${id}::uuid`;
    return {
      item: {
        ...b,
        fileName: b.upload.fileName,
        byteSize: b.upload.byteSize,
        startDate: day(b.startDate),
        endDate: day(b.endDate),
        openingBalance: b.openingBalance.toFixed(2),
        closingBalance: b.closingBalance.toFixed(2),
        receipts: b.receipts.toFixed(2),
        payments: b.payments.toFixed(2),
        duplicateCount: counts[0].count,
      },
      lines: lines.map((l) => ({
        ...l,
        valueDate: day(l.valueDate),
        amount: l.amount.toFixed(2),
      })),
      page,
      pages,
      history,
    };
  });
}
export async function statementBatches(
  actor: Pick<Actor, "id">,
  input: unknown = {},
) {
  return withFinanceAccess(actor, async (tx) => {
    const q = statementBatchQuerySchema.parse(input);
    await lock(tx);
    const where: Prisma.FinanceStatementBatchWhereInput = {
        state: q.state === "ALL" ? { in: ["IMPORTED", "VOIDED"] } : q.state,
        ...(q.cashAccountId ? { cashAccountId: q.cashAccountId } : {}),
        OR: [
          { number: { contains: q.q, mode: "insensitive" } },
          { upload: { fileName: { contains: q.q, mode: "insensitive" } } },
          { cashAccount: { name: { contains: q.q, mode: "insensitive" } } },
        ],
      },
      total = await tx.financeStatementBatch.count({ where }),
      pages = Math.max(1, Math.ceil(total / 25)),
      page = Math.min(q.page, pages),
      items = await tx.financeStatementBatch.findMany({
        where,
        select: {
          id: true,
          number: true,
          cashAccountId: true,
          cashAccount: { select: { name: true } },
          upload: { select: { fileName: true } },
          startDate: true,
          endDate: true,
          openingBalance: true,
          closingBalance: true,
          rowCount: true,
          state: true,
          replacedBy: { select: { id: true } },
        },
        orderBy: [{ endDate: "desc" }, { createdAt: "desc" }, { id: "asc" }],
        take: 25,
        skip: (page - 1) * 25,
      });
    return {
      items: items.map((b) => ({
        ...b,
        startDate: day(b.startDate),
        endDate: day(b.endDate),
        openingBalance: b.openingBalance.toFixed(2),
        closingBalance: b.closingBalance.toFixed(2),
      })),
      total,
      pages,
      page,
      filters: q,
    };
  });
}
export async function statementBankOptions(
  actor: Pick<Actor, "id">,
  input: unknown = {},
) {
  return withFinanceAccess(actor, async (tx) => {
    const q = z
      .object({
        q: z.string().trim().max(100).default(""),
        page: z.coerce.number().int().min(1).max(10000).default(1),
      })
      .strict()
      .parse(input);
    await lock(tx);
    const where: Prisma.FinanceCashAccountWhereInput = {
        active: true,
        currency: "PKR",
        glAccount: {
          active: true,
          isPosting: true,
          currency: "PKR",
          controlType: "CASH",
        },
        OR: [
          { name: { contains: q.q, mode: "insensitive" } },
          { maskedReference: { contains: q.q, mode: "insensitive" } },
        ],
      },
      total = await tx.financeCashAccount.count({ where }),
      pages = Math.max(1, Math.ceil(total / 25)),
      page = Math.min(q.page, pages),
      items = await tx.financeCashAccount.findMany({
        where,
        select: { id: true, name: true, kind: true, maskedReference: true },
        orderBy: [{ name: "asc" }, { id: "asc" }],
        take: 25,
        skip: (page - 1) * 25,
      });
    return {
      items: items.map((i) => ({
        id: i.id,
        code: i.kind,
        name: i.name + (i.maskedReference ? " · ••••" + i.maskedReference : ""),
      })),
      total,
      pages,
      page,
    };
  });
}
