import { it, expect } from "vitest";
import {
  parseStatementCsv,
  mapStatementCsv,
  parseStatementAmount,
  csvPreviewGrid,
  MAX_STATEMENT_BYTES,
} from "@/modules/finance/treasury/statements/csv";
const bytes = (s: string) => new TextEncoder().encode(s),
  grid = (s: string) => parseStatementCsv(bytes(s));
const mapping = {
  mode: "SIGNED",
  skipRows: 0,
  dateColumn: 0,
  dateFormat: "ISO",
  amountColumn: 1,
  positiveMeans: "RECEIPT",
  descriptionColumn: 2,
  referenceColumn: null,
};
it("UTF-8 BOM, quoted commas, escaped quotes, embedded newlines and CRLF preserve CSV records", () => {
  const csv =
      '\uFEFFDate,Amount,Description\r\n2026-11-14,"1,200.01","Reviewed ""deposit"", client\nsecond line"\r\n\r\n2026-11-15,-0.01,Fee\r\n',
    g = grid(csv),
    r = mapStatementCsv(g, mapping);
  expect(g).toHaveLength(3);
  expect(r.rows[0]).toMatchObject({
    sequence: 1,
    sourceRow: 2,
    valueDate: "2026-11-14",
    direction: "RECEIPT",
    amount: "1200.01",
    description: 'Reviewed "deposit", client second line',
  });
  expect(r.receipts).toBe("1200.01");
  expect(r.payments).toBe("0.01");
});
it("amount parsing is exact at the maximum range and rejects ambiguous grouping, numeric syntax and excessive scale", () => {
  expect(parseStatementAmount("(999,999,999,999,999,999.99)")).toEqual({
    amount: "999999999999999999.99",
    negative: true,
  });
  expect(parseStatementAmount("+00010.1")).toEqual({
    amount: "10.10",
    negative: false,
  });
  for (const n of [
    "1,23.00",
    "1.234",
    "1e3",
    "1 000",
    "PKR100",
    "NaN",
    "Infinity",
    "1000000000000000000.00",
    "--1.00",
  ])
    expect(() => parseStatementAmount(n)).toThrow();
  expect(() => parseStatementAmount("-1", false)).toThrow();
  expect(parseStatementAmount("-0.00")).toEqual({
    amount: "0.00",
    negative: false,
  });
});
it("date formats are explicit, real and independent of host time zone", () => {
  const g = grid("Date,Amount,Description\n02/03/2024,1,Review"),
    dmy = mapStatementCsv(g, { ...mapping, dateFormat: "DMY" }),
    mdy = mapStatementCsv(g, { ...mapping, dateFormat: "MDY" });
  expect(dmy.rows[0].valueDate).toBe("2024-03-02");
  expect(mdy.rows[0].valueDate).toBe("2024-02-03");
  for (const date of [
    "2026-02-30",
    "0000-01-01",
    "2026-1-01",
    "2026-11-14T01:00:00Z",
  ])
    expect(() =>
      mapStatementCsv(
        grid("Date,Amount,Description\n" + date + ",1,Review"),
        mapping,
      ),
    ).toThrow();
  expect(
    mapStatementCsv(
      grid("Date,Amount,Description\n9999-12-31,1,Review"),
      mapping,
    ).rows[0].valueDate,
  ).toBe("9999-12-31");
});
it("separate money-in/out columns retain direction and forbid zero or simultaneous positive sides", () => {
  const m = {
    mode: "DEBIT_CREDIT",
    dateColumn: 0,
    dateFormat: "ISO",
    debitColumn: 1,
    creditColumn: 2,
    descriptionColumn: 3,
    referenceColumn: null,
  };
  const r = mapStatementCsv(
    grid("Date,Out,In,Note\n2026-01-01,,10.01,Deposit\n2026-01-02,2.50,,Cost"),
    m,
  );
  expect(r.rows.map((v) => [v.direction, v.amount])).toEqual([
    ["RECEIPT", "10.01"],
    ["PAYMENT", "2.50"],
  ]);
  for (const row of ["1,1", "0,0", "-1,0"])
    expect(() =>
      mapStatementCsv(
        grid("Date,Out,In,Note\n2026-01-01," + row + ",Review"),
        m,
      ),
    ).toThrow();
  expect(
    mapStatementCsv(grid("Date,Amount,Description\n2026-01-01,-1,Refund"), {
      ...mapping,
      positiveMeans: "PAYMENT",
    }).rows[0].direction,
  ).toBe("RECEIPT");
});
it("empty, binary, malformed, ragged, oversized and overly wide CSV input is rejected", () => {
  for (const text of [
    "",
    "\u0000",
    'A,B\n"unfinished',
    'A,B\nx"bad,1',
    'A,B\n"x"junk,1',
    Array(51).fill("x").join(","),
    "A\n" + "x".repeat(4097),
  ])
    expect(() => grid(text)).toThrow();
  expect(() =>
    parseStatementCsv(new Uint8Array(MAX_STATEMENT_BYTES + 1)),
  ).toThrow();
  expect(() =>
    parseStatementCsv(Uint8Array.from([0xff, 0xfe, 0xff])),
  ).toThrow();
  expect(() =>
    mapStatementCsv(grid("Date,Amount,Description\n2026-01-01,1"), mapping),
  ).toThrow();
  expect(() =>
    mapStatementCsv(grid("Date,Amount,Description\n2026-01-01,1,Review"), {
      ...mapping,
      amountColumn: 0,
    }),
  ).toThrow();
});
it("5,000 rows are retained without dropping equal legitimate rows; preambles and preview strings stay bounded", () => {
  const header = "Date,Amount,Description",
    data = Array(5000).fill("2026-01-01,0.01,Identical legitimate rows"),
    g = grid(["Statement export", header, ...data].join("\n")),
    r = mapStatementCsv(g, { ...mapping, skipRows: 1 });
  expect(r.rows).toHaveLength(5000);
  expect(r.receipts).toBe("50.00");
  expect(csvPreviewGrid(g, 1).sample).toHaveLength(20);
  expect(() =>
    mapStatementCsv(grid([header, ...data, data[0]].join("\n")), mapping),
  ).toThrow();
  const h = grid("Date,Amount,Description\n2026-01-01,1," + "x".repeat(1000));
  expect(csvPreviewGrid(h).sample[0].cells[2]).toHaveLength(200);
  expect(() => csvPreviewGrid(h, 26)).toThrow();
});
