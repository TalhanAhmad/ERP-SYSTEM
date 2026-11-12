export function formatPkr(value: string) {
  const [whole, fraction = "00"] = value.split(".");
  return (
    "PKR " +
    whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",") +
    "." +
    fraction.padEnd(2, "0")
  );
}
export function MoneyCell({ value }: { value: string }) {
  return <span className="money-cell">{formatPkr(value)}</span>;
}
