import { z } from "zod";
export function parseCsv(text: string, maxRows = 500) {
  if (new TextEncoder().encode(text).length > 2097152)
    throw new Error("CSV exceeds 2 MB.");
  text = text.replace(/^\uFEFF/, "");
  const records: string[][] = [];
  let row: string[] = [],
    cell = "",
    quoted = false,
    closed = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else {
          quoted = false;
          closed = true;
        }
      } else cell += c;
      continue;
    }
    if (closed && ![",", "\r", "\n"].includes(c))
      throw new Error("Unexpected text after a quoted CSV cell.");
    if (c === '"') {
      if (cell) throw new Error("Quote a CSV cell from its first character.");
      quoted = true;
      continue;
    }
    if (c === ",") {
      row.push(cell);
      cell = "";
      closed = false;
      continue;
    }
    if (c === "\r" || c === "\n") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(cell);
      if (row.some((v) => v.length)) records.push(row);
      if (records.length > maxRows + 1)
        throw new Error(`CSV supports at most ${maxRows} task rows.`);
      row = [];
      cell = "";
      closed = false;
      continue;
    }
    cell += c;
  }
  if (quoted) throw new Error("CSV has an unclosed quoted cell.");
  if (cell || row.length || closed) {
    row.push(cell);
    if (row.some((v) => v.length)) records.push(row);
  }
  if (records.length > maxRows + 1)
    throw new Error(`CSV supports at most ${maxRows} task rows.`);
  if (records.length < 2)
    throw new Error("CSV needs a header and at least one task row.");
  const headers = records[0].map((h) => h.trim());
  const allowed = [
    "title",
    "description",
    "assignee",
    "reviewer",
    "priority",
    "due_at",
  ];
  if (
    new Set(headers).size !== headers.length ||
    headers.some((h) => !allowed.includes(h)) ||
    ["title", "assignee", "reviewer"].some((h) => !headers.includes(h))
  )
    throw new Error(
      "Use title, assignee, reviewer, and optional description, priority, due_at headers.",
    );
  return records.slice(1).map((values, i) => {
    if (values.length !== headers.length)
      throw new Error(`Row ${i + 2} has the wrong number of cells.`);
    return Object.fromEntries(headers.map((h, n) => [h, values[n]]));
  });
}
export const csvTaskSchema = z
  .object({
    title: z.string().trim().min(1).max(200),
    description: z.string().max(5000).default(""),
    assignee: z
      .string()
      .trim()
      .transform((v) => v.replace(/^@/, "").toLowerCase())
      .pipe(z.string().regex(/^[a-z0-9._-]{3,30}$/)),
    reviewer: z
      .string()
      .trim()
      .transform((v) => v.replace(/^@/, "").toLowerCase())
      .pipe(z.string().regex(/^[a-z0-9._-]{3,30}$/)),
    priority: z.preprocess(
      (v) => (v === "" || v === undefined ? "NORMAL" : String(v).toUpperCase()),
      z.enum(["LOW", "NORMAL", "HIGH", "URGENT"]),
    ),
    due_at: z.preprocess(
      (v) => (v === "" || v === undefined ? undefined : v),
      z.iso.datetime({ offset: true }).optional(),
    ),
  })
  .strict()
  .refine((v) => v.assignee !== v.reviewer, {
    message: "Reviewer must differ from assignee.",
    path: ["reviewer"],
  });
