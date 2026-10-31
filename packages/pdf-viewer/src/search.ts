export interface SearchMatch { page: number; /** index of match within page */ index: number; offset: number }

export function findMatches(pagesText: string[], query: string): SearchMatch[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const out: SearchMatch[] = [];
  pagesText.forEach((t, page) => {
    const s = t.toLowerCase();
    let i = s.indexOf(q), n = 0;
    while (i !== -1) { out.push({ page, index: n++, offset: i }); i = s.indexOf(q, i + q.length); }
  });
  return out;
}
export type Segment = { text: string; hit: boolean };
export function highlightSegments(text: string, query: string): Segment[] {
  const q = query.trim().toLowerCase();
  if (!q) return [{ text, hit: false }];
  const segs: Segment[] = [], low = text.toLowerCase();
  let pos = 0, i = low.indexOf(q);
  while (i !== -1) {
    if (i > pos) segs.push({ text: text.slice(pos, i), hit: false });
    segs.push({ text: text.slice(i, i + q.length), hit: true });
    pos = i + q.length; i = low.indexOf(q, pos);
  }
  if (pos < text.length) segs.push({ text: text.slice(pos), hit: false });
  return segs;
}
