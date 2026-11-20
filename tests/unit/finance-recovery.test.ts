import { it, expect } from "vitest";
import { constraintExpression } from "../../scripts/finance/constraint-expression";
import { rollbackBody } from "../../scripts/finance/rehearse-migration";
it("compares reparsed associative CHECKs while preserving OR, NOT, arithmetic and literal meanings", () => {
  expect(constraintExpression("((a AND b) AND (c AND d))")).toEqual(
    constraintExpression("(a AND b AND (c AND d))"),
  );
  for (const [a, b] of [
    ["(a OR b) AND c", "a OR (b AND c)"],
    ["NOT (a AND b)", "NOT a AND b"],
    ["amount >= 0", "amount > 0"],
    ["kind = 'A AND B'", "kind = 'A OR B'"],
    ["(a+b)*c", "a+(b*c)"],
  ])
    expect(constraintExpression(a)).not.toEqual(constraintExpression(b));
});
it("keeps literal transaction words and nested comments but refuses an escaping top-level commit", () => {
  const sql =
    "BEGIN; /* comment /* COMMIT; */ still comment */ SELECT 'COMMIT;', $$ BEGIN COMMIT; END $$; COMMIT;";
  expect(rollbackBody(sql)).toContain("SELECT 'COMMIT;'");
  for (const s of [
    "BEGIN; SELECT 1; COMMIT; BEGIN; COMMIT;",
    "BEGIN; SELECT 1; END; COMMIT;",
    "BEGIN; ROLLBACK; COMMIT;",
    "BEGIN; ABORT; COMMIT;",
    "BEGIN; SELECT 1; PREPARE TRANSACTION 'escape'; COMMIT;",
    "SELECT 1;",
  ])
    expect(() => rollbackBody(s)).toThrow();
});
