import "server-only";
import { Prisma } from "@/generated/prisma/client";
import { z } from "zod";
import { invariant } from "@/server/errors";
// Do not change Prisma's global Decimal precision (20 significant digits).
// 64 safely covers products of two NUMERIC(20,6) inputs and line aggregation.
const Decimal = Prisma.Decimal.clone({
  precision: 64,
  rounding: Prisma.Decimal.ROUND_HALF_UP,
});
const maximum = new Decimal("999999999999999999.99");
export const pkrCurrencySchema = z.literal("PKR");
// A true end-of-input assertion also rejects final line terminators (unlike $).
export const pkrAmountSchema = z
  .string()
  .regex(
    /^(?:0|[1-9]\d{0,17})(?:\.\d{1,2})?(?![\s\S])/,
    "Use a nonnegative decimal string with at most 18 integer and 2 fractional digits.",
  )
  .transform((value) => new Decimal(value).toFixed(2));
const precise = z
  .string()
  .regex(
    /^(?:0|[1-9]\d{0,13})(?:\.\d{1,6})?(?![\s\S])/,
    "Use a nonnegative decimal string with at most 14 integer and 6 fractional digits.",
  );
export const quantitySchema = precise.pipe(
  z
    .string()
    .refine((value) => new Decimal(value).gt(0), "Quantity must be positive."),
);
export const unitRateSchema = precise;
export function parsePkr(value: unknown) {
  return pkrAmountSchema.parse(value);
}
function bounded(value: Prisma.Decimal) {
  invariant(
    value.isFinite() && value.gte(0) && value.lte(maximum),
    "PKR_RANGE",
    "Amount exceeds the supported PKR range.",
    422,
  );
  return value.toFixed(2);
}
export function calculatePkrLine(quantity: unknown, unitRate: unknown) {
  return bounded(
    new Decimal(quantitySchema.parse(quantity))
      .times(unitRateSchema.parse(unitRate))
      .toDecimalPlaces(2, Decimal.ROUND_HALF_UP),
  );
}
export function sumPkrLines(lines: readonly unknown[]) {
  invariant(
    lines.length <= 10000,
    "LINE_LIMIT",
    "At most 10,000 rounded lines can be totaled.",
    422,
  );
  let total = new Decimal(0);
  for (const line of lines) total = total.plus(pkrAmountSchema.parse(line));
  return bounded(total);
}

export function subtractPkr(value: unknown, deduction: unknown) {
  const amount = new Decimal(parsePkr(value)),
    discount = new Decimal(parsePkr(deduction));
  invariant(
    discount.lte(amount),
    "PKR_DEDUCTION",
    "Discount cannot exceed the rounded line amount.",
    422,
  );
  return bounded(amount.minus(discount));
}
