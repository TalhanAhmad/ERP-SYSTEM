import { z } from "zod";
import { pkrAmountSchema } from "../../accounting/money";
import { invariant } from "@/server/errors";
const percent = z.string().regex(/^(?:0|[1-9]\d{0,2})(?:\.\d{1,6})?(?![\s\S])/);
const scaled = (v: string, places: number) => {
  const [whole, fraction = ""] = v.split(".");
  return (
    BigInt(whole) * 10n ** BigInt(places) + BigInt(fraction.padEnd(places, "0"))
  );
};
const fixed = (v: bigint) => `${v / 100n}.${String(v % 100n).padStart(2, "0")}`;
export function splitCostPercentages(
  amount: unknown,
  input: readonly string[],
) {
  const money = pkrAmountSchema.parse(amount);
  invariant(
    input.length > 0 && input.length <= 100,
    "FINANCE_COST_SPLIT",
    "Use one to100 percentage splits.",
    422,
  );
  const values = input.map((v) => scaled(percent.parse(v), 6)),
    denominator = 100000000n,
    total = scaled(money, 2);
  invariant(
    values.every((v) => v <= denominator) &&
      values.reduce((a, b) => a + b, 0n) === denominator,
    "FINANCE_COST_SPLIT",
    "Percentages must total exactly100%.",
    422,
  );
  const parts = values.map((v, index) => ({
    index,
    amount: (total * v) / denominator,
    remainder: (total * v) % denominator,
  }));
  let left = total - parts.reduce((sum, p) => sum + p.amount, 0n);
  const ranked = [...parts].sort((a, b) =>
    a.remainder === b.remainder
      ? a.index - b.index
      : a.remainder > b.remainder
        ? -1
        : 1,
  );
  for (let i = 0; left > 0n; i++, left--) ranked[i].amount++;
  return parts.map((p) => fixed(p.amount));
}
