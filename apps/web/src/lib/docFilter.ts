import type { DocumentInfo } from "@thynkpdf/editor-client";
export type SortKey = "created_desc" | "created_asc" | "name_asc" | "name_desc";
/** Client-side filter/sort of the already-loaded document list (server-side search is a backend request, R5.1). */
export function filterDocs(docs: DocumentInfo[], q: string, sort: SortKey): DocumentInfo[] {
  const needle = q.trim().toLowerCase();
  const out = needle ? docs.filter((d) => d.filename.toLowerCase().includes(needle)) : [...docs];
  const cmp: Record<SortKey, (a: DocumentInfo, b: DocumentInfo) => number> = {
    created_desc: (a, b) => b.created_at.localeCompare(a.created_at),
    created_asc: (a, b) => a.created_at.localeCompare(b.created_at),
    name_asc: (a, b) => a.filename.localeCompare(b.filename),
    name_desc: (a, b) => b.filename.localeCompare(a.filename),
  };
  return out.sort(cmp[sort]);
}
