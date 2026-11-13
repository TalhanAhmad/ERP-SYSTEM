// Browser-only arithmetic preview. PostgreSQL independently validates saved amounts.
export function invoicePreview(
  lines: readonly {
    quantity: string;
    unitRate: string;
    discountAmount: string;
  }[],
) {
  if (!lines.length || lines.length > 100)
    throw new Error("Provide 1–100 lines.");
  const scaled = (v: string, places: number, digits: number) => {
    if (
      !new RegExp(
        "^(0|[1-9][0-9]{0," +
          (digits - 1) +
          "})([.][0-9]{1," +
          places +
          "})?(?![\\s\\S])",
      ).test(v)
    )
      throw new Error("Invalid decimal string.");
    const [a, b = ""] = v.split(".");
    return BigInt(a) * 10n ** BigInt(places) + BigInt(b.padEnd(places, "0"));
  };
  const max = 99999999999999999999n;
  let total = 0n,
    grossTotal = 0n,
    discounts = 0n;
  for (const l of lines) {
    const q = scaled(l.quantity, 6, 14),
      r = scaled(l.unitRate, 6, 14),
      d = scaled(l.discountAmount, 2, 18),
      gross = (q * r + 5000000000n) / 10000000000n;
    if (q <= 0 || gross > max || d > gross)
      throw new Error("Check quantity or discount.");
    grossTotal += gross;
    discounts += d;
    if (grossTotal > max || discounts > max)
      throw new Error("Amount outside range.");
    total += gross - d;
    if (total > max) throw new Error("Amount outside range.");
  }
  return (
    (total / 100n).toString() + "." + (total % 100n).toString().padStart(2, "0")
  );
}
