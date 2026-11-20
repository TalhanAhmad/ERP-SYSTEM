import pg from "pg";
/** Remove only transaction wrappers; lex quoted/commented bodies so inner PL/pgSQL BEGIN is not a wrapper. */
export function rollbackBody(sql: string) {
  const statements: string[] = [];
  let code = "",
    i = 0;
  while (i < sql.length) {
    const rest = sql.slice(i);
    if (rest.startsWith("--")) {
      const end = sql.indexOf("\n", i + 2);
      i = end < 0 ? sql.length : end;
      code += " ";
      continue;
    }
    if (rest.startsWith("/*")) {
      let depth = 1;
      i += 2;
      while (depth && i < sql.length) {
        if (sql.slice(i, i + 2) === "/*") {
          depth++;
          i += 2;
        } else if (sql.slice(i, i + 2) === "*/") {
          depth--;
          i += 2;
        } else i++;
      }
      if (depth) throw Error("Unterminated migration comment.");
      code += " ";
      continue;
    }
    const dollar = rest.match(/^\$(?:[a-zA-Z_][a-zA-Z0-9_]*)?\$/)?.[0];
    if (dollar) {
      const end = sql.indexOf(dollar, i + dollar.length);
      if (end < 0) throw Error("Unterminated migration body.");
      i = end + dollar.length;
      code += " ";
      continue;
    }
    if (sql[i] === "'" || sql[i] === '"') {
      const q = sql[i++];
      let closed = false;
      while (i < sql.length) {
        if (sql[i] === q) {
          i++;
          if (sql[i] === q) {
            i++;
            continue;
          }
          closed = true;
          break;
        }
        if (sql[i] === "\\" && q === "'") i += 2;
        else i++;
      }
      if (!closed) throw Error("Unterminated migration literal.");
      code += " ";
      continue;
    }
    if (sql[i] === ";") {
      statements.push(code.trim());
      code = "";
      i++;
      continue;
    }
    code += sql[i++];
  }
  if (code.trim()) statements.push(code.trim());
  const meaningful = statements.filter(Boolean);
  if (
    meaningful[0]?.toUpperCase() !== "BEGIN" ||
    meaningful.at(-1)?.toUpperCase() !== "COMMIT"
  )
    throw Error("Explicit outer BEGIN/COMMIT migration required.");
  if (
    meaningful
      .slice(1, -1)
      .some((s) =>
        /^(?:BEGIN|COMMIT|ROLLBACK|ABORT|END|START\s+TRANSACTION|PREPARE\s+TRANSACTION)\b/i.test(
          s,
        ),
      )
  )
    throw Error("Nested transaction control cannot escape rollback.");
  // Exact outer wrapper positions are deliberately strict for repository migrations.
  if (!/^\s*BEGIN\s*;/i.test(sql) || !/COMMIT\s*;\s*$/i.test(sql))
    throw Error("Outer transaction wrappers must bound the file.");
  return sql.replace(/^\s*BEGIN\s*;/i, "").replace(/COMMIT\s*;\s*$/i, "");
}
export async function rehearseMigration(sql: pg.Client, migration: string) {
  const body = rollbackBody(migration);
  await sql.query("BEGIN");
  try {
    await sql.query(body);
  } finally {
    await sql.query("ROLLBACK");
  }
}
