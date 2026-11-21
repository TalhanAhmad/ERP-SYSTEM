// Normalize only associative Boolean grouping emitted differently after pg_dump/reparse.
// Preserve OR/NOT boundaries, atom text, operator order and all quoted literals.
export function constraintExpression(value: string): unknown {
  let text = value.trim();
  const positions = (s: string) => {
    let depth = 0,
      quote = "",
      caseDepth = 0;
    const words: { word: string; at: number }[] = [];
    for (let i = 0; i < s.length; i++) {
      const c = s[i];
      if (quote) {
        if (c === quote) {
          if (s[i + 1] === quote) i++;
          else quote = "";
        }
        continue;
      }
      if (c === "'" || c === '"') {
        quote = c;
        continue;
      }
      if (c === "(") {
        depth++;
        continue;
      }
      if (c === ")") {
        depth--;
        continue;
      }
      if (
        depth === 0 &&
        /[A-Za-z_]/.test(c) &&
        (i === 0 || !/[A-Za-z0-9_]/.test(s[i - 1]))
      ) {
        const match = s.slice(i).match(/^[A-Za-z_][A-Za-z0-9_]*/)![0],
          word = match.toUpperCase();
        if (word === "CASE") caseDepth++;
        if (word === "END") caseDepth--;
        if (caseDepth === 0 && ["AND", "OR"].includes(word))
          words.push({ word, at: i });
        i += match.length - 1;
      }
    }
    return { words, depth };
  };
  while (text.startsWith("(") && text.endsWith(")")) {
    let depth = 0,
      quote = "",
      encloses = true;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (quote) {
        if (c === quote) {
          if (text[i + 1] === quote) i++;
          else quote = "";
        }
        continue;
      }
      if (c === "'" || c === '"') {
        quote = c;
        continue;
      }
      if (c === "(") depth++;
      if (c === ")") depth--;
      if (depth === 0 && i < text.length - 1) {
        encloses = false;
        break;
      }
    }
    if (!encloses) break;
    text = text.slice(1, -1).trim();
  }
  const { words } = positions(text);
  for (const operator of ["OR", "AND"]) {
    const breaks = words.filter((w) => w.word === operator);
    if (!breaks.length) continue;
    let start = 0;
    const children: unknown[] = [];
    for (const b of breaks) {
      children.push(constraintExpression(text.slice(start, b.at)));
      start = b.at + operator.length;
    }
    children.push(constraintExpression(text.slice(start)));
    return {
      operator,
      children: children.flatMap((child) => {
        const c = child as { operator?: string; children?: unknown[] };
        return c.operator === operator ? c.children! : [child];
      }),
    };
  }
  if (/^NOT\b/i.test(text))
    return { operator: "NOT", child: constraintExpression(text.slice(3)) };
  return text;
}
