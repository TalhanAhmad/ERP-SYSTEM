import "server-only";
import { z } from "zod";
import { AppError } from "@/server/errors";
import { accountingDateSchema } from "../../accounting/schemas";
import { pkrAmountSchema } from "../../accounting/money";
import { MAX_STATEMENT_BYTES, MAX_STATEMENT_ROWS } from "./limits";
export {
  MAX_STATEMENT_BYTES,
  MAX_STATEMENT_ROWS,
  STATEMENT_CHUNK_BYTES,
} from "./limits";
const MAX_COLUMNS = 50,
  MAX_FIELD = 4096,
  MAX_SKIP = 25;
const index = z
  .number()
  .int()
  .min(0)
  .max(MAX_COLUMNS - 1);
const mappingBase = {
  skipRows: z.number().int().min(0).max(MAX_SKIP).default(0),
  dateColumn: index,
  dateFormat: z.enum(["ISO", "DMY", "MDY"]),
  descriptionColumn: index.nullable().default(null),
  referenceColumn: index.nullable().default(null),
};
export const statementMappingSchema = z
  .discriminatedUnion("mode", [
    z
      .object({
        ...mappingBase,
        mode: z.literal("SIGNED"),
        amountColumn: index,
        positiveMeans: z.enum(["RECEIPT", "PAYMENT"]),
      })
      .strict(),
    z
      .object({
        ...mappingBase,
        mode: z.literal("DEBIT_CREDIT"),
        debitColumn: index,
        creditColumn: index,
      })
      .strict(),
  ])
  .refine((v) => {
    const columns = [
      v.dateColumn,
      v.descriptionColumn,
      v.referenceColumn,
      ...(v.mode === "SIGNED"
        ? [v.amountColumn]
        : [v.debitColumn, v.creditColumn]),
    ].filter((i): i is number => i !== null);
    return new Set(columns).size === columns.length;
  }, "Use distinct mapped columns.");
export type StatementMapping = z.output<typeof statementMappingSchema>;
export type StatementRow = {
  sequence: number;
  sourceRow: number;
  valueDate: string;
  direction: "RECEIPT" | "PAYMENT";
  amount: string;
  description: string;
  bankReference: string;
};
function fail(message: string): never {
  throw new AppError("FINANCE_STATEMENT_CSV", message, 422);
}
export function parseStatementCsv(bytes: Uint8Array): string[][] {
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_STATEMENT_BYTES)
    fail("Choose a nonempty CSV no larger than 5 MB (5,000,000 bytes).");
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    fail("Save the CSV using UTF-8 encoding.");
  }
  text = text!.replace(/^\uFEFF/, "");
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(text))
    fail("The CSV contains unsupported binary/control characters.");
  const records: string[][] = [];
  let row: string[] = [],
    field = "",
    quoted = false,
    closed = false;
  const append = (c: string) => {
    field += c;
    if (field.length > MAX_FIELD) fail("A CSV field exceeds 4,096 characters.");
  };
  const cell = () => {
    row.push(field);
    field = "";
    closed = false;
    if (row.length > MAX_COLUMNS)
      fail("A CSV record has more than 50 columns.");
  };
  const record = () => {
    cell();
    if (row.some((c) => c.trim() !== "")) {
      records.push(row);
      if (records.length > MAX_STATEMENT_ROWS + MAX_SKIP + 1)
        fail(
          "The CSV exceeds 5,000 data rows plus its bounded header/preamble.",
        );
    }
    row = [];
  };
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          append('"');
          i++;
        } else {
          quoted = false;
          closed = true;
        }
      } else append(c);
      continue;
    }
    if (c === ",") {
      cell();
      continue;
    }
    if (c === "\r" || c === "\n") {
      record();
      if (c === "\r" && text[i + 1] === "\n") i++;
      continue;
    }
    if (closed) fail("Unexpected characters after a closing CSV quote.");
    if (c === '"') {
      if (field !== "")
        fail("Quote an entire CSV field rather than part of it.");
      quoted = true;
    } else append(c);
  }
  if (quoted) fail("The CSV has an unterminated quoted field.");
  if (field !== "" || row.length > 0 || closed) record();
  if (records.length === 0) fail("The CSV has no header or data records.");
  return records;
}
export function csvPreviewGrid(records: string[][], skipRows = 0) {
  if (
    !Number.isInteger(skipRows) ||
    skipRows < 0 ||
    skipRows > MAX_SKIP ||
    !records[skipRows]
  )
    fail("Choose a header among the first 26 nonempty CSV records.");
  return {
    headers: records[skipRows].map((h, i) => ({
      index: i,
      name: (h || "Column " + (i + 1)).slice(0, 100),
    })),
    sample: records.slice(skipRows + 1, skipRows + 21).map((r, i) => ({
      sourceRow: skipRows + i + 2,
      cells: r.map((c) => c.slice(0, 200)),
    })),
    dataRows: records.length - skipRows - 1,
    skipRows,
  };
}
function valueDate(
  input: string,
  format: StatementMapping["dateFormat"],
  row: number,
) {
  const text = input.trim(),
    m =
      format === "ISO"
        ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(text)
        : /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(text);
  if (!m)
    fail(
      "CSV record " + row + ": date does not match the selected date format.",
    );
  const date =
      format === "ISO"
        ? text
        : format === "DMY"
          ? m![3] + "-" + m![2] + "-" + m![1]
          : m![3] + "-" + m![1] + "-" + m![2],
    parsed = accountingDateSchema.safeParse(date);
  if (!parsed.success)
    fail("CSV record " + row + ": choose a real Gregorian date.");
  return parsed.data;
}
export function parseStatementAmount(
  input: string,
  allowNegative = true,
): { amount: string; negative: boolean } {
  let text = input.trim(),
    negative = false;
  if (text.length > 64) fail("A bank amount exceeds the supported format.");
  if (text.startsWith("(") && text.endsWith(")")) {
    negative = true;
    text = text.slice(1, -1);
  } else if (text.startsWith("-") || text.startsWith("+")) {
    negative = text[0] === "-";
    text = text.slice(1);
  }
  if (!allowNegative && negative)
    fail("Use positive values in separate money-in/money-out columns.");
  if (!/^(?:\d+|[1-9]\d{0,2}(?:,\d{3})+)(?:\.\d{1,2})?$/.test(text))
    fail(
      "Use exact dot-decimal bank amounts with optional correctly grouped comma thousands.",
    );
  text = text.replaceAll(",", "").replace(/^0+(?=\d)/, "");
  const amount = pkrAmountSchema.safeParse(text);
  if (!amount.success)
    fail("A bank amount exceeds the supported exact PKR range.");
  return { amount: amount.data, negative: negative && amount.data !== "0.00" };
}
const clean = (value: string, max: number, kind: string, row: number) => {
  const v = value.replace(/\s+/g, " ").trim();
  if (v.length > max) fail("CSV record " + row + ": " + kind + " is too long.");
  return v;
};
export function mapStatementCsv(
  records: string[][],
  input: unknown,
): {
  headers: string[];
  mapping: StatementMapping;
  rows: StatementRow[];
  receipts: string;
  payments: string;
} {
  const mapping = statementMappingSchema.parse(input),
    headers = records[mapping.skipRows];
  if (!headers) fail("Choose a valid CSV header record.");
  const data = records.slice(mapping.skipRows + 1);
  if (data.length === 0 || data.length > MAX_STATEMENT_ROWS)
    fail("Import between 1 and 5,000 data rows.");
  const indices = [
    mapping.dateColumn,
    mapping.descriptionColumn,
    mapping.referenceColumn,
    ...(mapping.mode === "SIGNED"
      ? [mapping.amountColumn]
      : [mapping.debitColumn, mapping.creditColumn]),
  ].filter((v): v is number => v !== null);
  if (indices.some((i) => i >= headers.length))
    fail("A mapped column is outside the CSV header.");
  let receipts = 0n,
    payments = 0n;
  const rows = data.map((cells, i): StatementRow => {
    const sourceRow = mapping.skipRows + i + 2;
    if (cells.length !== headers.length)
      fail(
        "CSV record " +
          sourceRow +
          ": column count differs from the chosen header.",
      );
    let amount: string, direction: "RECEIPT" | "PAYMENT";
    if (mapping.mode === "SIGNED") {
      const value = parseStatementAmount(cells[mapping.amountColumn]);
      amount = value.amount;
      direction = value.negative
        ? mapping.positiveMeans === "RECEIPT"
          ? "PAYMENT"
          : "RECEIPT"
        : mapping.positiveMeans;
    } else {
      const debit = cells[mapping.debitColumn].trim()
          ? parseStatementAmount(cells[mapping.debitColumn], false).amount
          : "0.00",
        credit = cells[mapping.creditColumn].trim()
          ? parseStatementAmount(cells[mapping.creditColumn], false).amount
          : "0.00";
      if (debit !== "0.00" && credit !== "0.00")
        fail(
          "CSV record " +
            sourceRow +
            ": money-in and money-out cannot both be positive.",
        );
      amount = credit !== "0.00" ? credit : debit;
      direction = credit !== "0.00" ? "RECEIPT" : "PAYMENT";
    }
    if (amount === "0.00")
      fail(
        "CSV record " +
          sourceRow +
          ": a cash line must have a positive amount.",
      );
    const cents = BigInt(amount.replace(".", ""));
    if (direction === "RECEIPT") receipts += cents;
    else payments += cents;
    return {
      sequence: i + 1,
      sourceRow,
      valueDate: valueDate(
        cells[mapping.dateColumn],
        mapping.dateFormat,
        sourceRow,
      ),
      direction,
      amount,
      description:
        mapping.descriptionColumn === null
          ? ""
          : clean(
              cells[mapping.descriptionColumn],
              1000,
              "description",
              sourceRow,
            ),
      bankReference:
        mapping.referenceColumn === null
          ? ""
          : clean(
              cells[mapping.referenceColumn],
              200,
              "bank reference",
              sourceRow,
            ),
    };
  });
  const money = (cents: bigint) => {
    const s = cents.toString().padStart(3, "0");
    return s.slice(0, -2) + "." + s.slice(-2);
  };
  return {
    headers,
    mapping,
    rows,
    receipts: money(receipts),
    payments: money(payments),
  };
}
