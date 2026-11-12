import { describe, it, expect } from "vitest";
import { Prisma } from "@/generated/prisma/client";
import {
  parsePkr,
  calculatePkrLine,
  sumPkrLines,
  quantitySchema,
  unitRateSchema,
  pkrCurrencySchema,
} from "@/modules/finance/accounting/money";
import {
  accountSchema,
  accountUpdateSchema,
  periodSchema,
  accountQuerySchema,
  accountingDateSchema,
} from "@/modules/finance/accounting/schemas";
describe("Exact PKR boundaries", () => {
  it.each([
    ["0", "0.00"],
    ["1.2", "1.20"],
    ["999999999999999999.99", "999999999999999999.99"],
    ["123456789012345678.01", "123456789012345678.01"],
  ])("normalizes %s without floating conversion", (input, expected) =>
    expect(parsePkr(input)).toBe(expected),
  );
  it.each([
    1,
    0.1,
    null,
    true,
    "",
    " 1.00",
    "1.00 ",
    "1.00\n",
    "1.00\r\n",
    "1.00\u2028",
    "1.00\u2029",
    "01.00",
    "+1.00",
    "-0.00",
    "-1.00",
    ".50",
    "1.",
    "NaN",
    "Infinity",
    "1e3",
    "1E-2",
    "1,000.00",
    "1.001",
    "1000000000000000000.00",
  ])("rejects unsafe monetary input %s", (value) =>
    expect(() => parsePkr(value)).toThrow(),
  );
  it("rejects non-PKR currency and excessive rate/quantity precision", () => {
    expect(pkrCurrencySchema.safeParse("USD").success).toBe(false);
    for (const value of ["0", "0.0000001", "100000000000000", 1, "1e2"])
      expect(quantitySchema.safeParse(value).success).toBe(false);
    expect(unitRateSchema.safeParse("1.1234567").success).toBe(false);
    for (const value of [
      "1\n",
      "1\r\n",
      "1\u2028",
      "1\u2029",
      "not a number",
    ]) {
      expect(quantitySchema.safeParse(value).success).toBe(false);
      expect(unitRateSchema.safeParse(value).success).toBe(false);
    }
    expect(unitRateSchema.safeParse("0.000001").success).toBe(true);
  });
  it("rounds each product HALF_UP before aggregating canonical line totals", () => {
    expect(calculatePkrLine("1", "1.005")).toBe("1.01");
    expect(calculatePkrLine("0.333333", "3")).toBe("1.00");
    expect(calculatePkrLine("1", "0.004999")).toBe("0.00");
    expect(
      sumPkrLines(
        Array.from({ length: 10 }, () => calculatePkrLine("1", "0.005")),
      ),
    ).toBe("0.10");
  });
  it("keeps arithmetic exact beyond Number.MAX_SAFE_INTEGER and checks overflow after rounding", () => {
    expect(sumPkrLines(["9007199254740993.01", "0.09"])).toBe(
      "9007199254740993.10",
    );
    expect(() => sumPkrLines(["999999999999999999.99", "0.01"])).toThrow(
      "supported PKR range",
    );
    expect(() => calculatePkrLine("99999999999999", "99999999999999")).toThrow(
      "supported PKR range",
    );
    expect(sumPkrLines([])).toBe("0.00");
    expect(() => sumPkrLines(new Array(10001).fill("0.01"))).toThrow("10,000");
  });
  it("does not change the ORM's global decimal precision", () => {
    const original = Prisma.Decimal.precision;
    calculatePkrLine("123.123456", "1.000001");
    expect(Prisma.Decimal.precision).toBe(original);
  });
});
const asset = {
  code: "1010",
  name: "Test asset",
  type: "ASSET",
  normalSide: "DEBIT",
  reportGroup: "CURRENT_ASSETS",
  controlType: "NONE",
  currency: "PKR",
  isPosting: true,
  isContra: false,
  isCashEquivalent: false,
  reason: "Reviewed fixture configuration",
};
it("validates chart classifications and contra/control flags without guessing a tax policy", () => {
  expect(accountSchema.parse({ ...asset, code: "asset-01" }).code).toBe(
    "ASSET-01",
  );
  for (const patch of [
    { currency: "USD" },
    { type: "LIABILITY" },
    { normalSide: "CREDIT" },
    { reportGroup: "REVENUE" },
    { controlType: "PAYABLES" },
    { isCashEquivalent: true },
    { isPosting: false, controlType: "CASH" },
    { balance: "100.00" },
  ])
    expect(accountSchema.safeParse({ ...asset, ...patch }).success).toBe(false);
  expect(
    accountSchema.safeParse({
      ...asset,
      isContra: true,
      normalSide: "CREDIT",
      controlType: "ACCUMULATED_DEPRECIATION",
    }).success,
  ).toBe(true);
  expect(
    accountUpdateSchema.safeParse({ ...asset, expectedVersion: 2147483648 })
      .success,
  ).toBe(false);
});
it("validates actual calendar dates and inclusive period order", () => {
  for (const value of [
    "2026-02-29",
    "2026-04-31",
    "0000-01-01",
    "12/11/2026",
    "2026-01-01T00:00:00Z",
  ])
    expect(accountingDateSchema.safeParse(value).success).toBe(false);
  expect(accountingDateSchema.safeParse("2028-02-29").success).toBe(true);
  expect(
    periodSchema.safeParse({
      name: "One day",
      startDate: "2028-02-29",
      endDate: "2028-02-29",
      reason: "Explicit period dates",
    }).success,
  ).toBe(true);
  expect(
    periodSchema.safeParse({
      name: "Reversed",
      startDate: "2028-03-01",
      endDate: "2028-02-29",
      reason: "Invalid order",
    }).success,
  ).toBe(false);
  expect(accountQuerySchema.safeParse({ sort: "DROP TABLE" }).success).toBe(
    false,
  );
  expect(accountQuerySchema.safeParse({ pageSize: 101 }).success).toBe(false);
});
