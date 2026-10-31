/** Parse "1-3, 5, 7-8" into 1-based inclusive ranges, validated against pageCount. */
export function parseRanges(input: string, pageCount: number): { ranges: [number, number][] } | { error: string } {
  const parts = input.split(",").map((s) => s.trim()).filter(Boolean);
  if (!parts.length) return { error: "Enter at least one range, e.g. 1-2, 3" };
  const ranges: [number, number][] = [];
  for (const p of parts) {
    const m = /^(\d+)(?:\s*-\s*(\d+))?$/.exec(p);
    if (!m) return { error: `“${p}” is not a page or range` };
    const a = +m[1], b = m[2] ? +m[2] : a;
    if (a < 1 || b > pageCount || a > b) return { error: `“${p}” is outside 1–${pageCount}` };
    ranges.push([a, b]);
  }
  return { ranges };
}
