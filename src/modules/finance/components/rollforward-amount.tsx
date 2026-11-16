import { MoneyCell } from "./money-cell";
export function RollforwardAmount({
  value,
  unit,
}: {
  value: string;
  unit: "PKR" | "UNITS";
}) {
  if (unit === "PKR") return <MoneyCell value={value} />;
  const negative = value.startsWith("-"),
    absolute = negative ? value.slice(1) : value,
    [whole, fraction = "000000"] = absolute.split(".");
  return (
    <span>
      {negative ? "−" : ""}
      {BigInt(whole).toLocaleString("en-GB")}.{fraction} units
    </span>
  );
}
