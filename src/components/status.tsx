export function Status({ value }: { value: string }) {
  return (
    <span className={`badge ${value}`}>
      {value.replaceAll("_", " ").toLowerCase()}
    </span>
  );
}
