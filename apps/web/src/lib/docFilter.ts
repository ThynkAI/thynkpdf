import type { ListQuery } from "@thynkpdf/editor-client";
export type SortKey = "updated_desc" | "created_desc" | "created_asc" | "name_asc" | "name_desc";
export type View = { kind: "all" } | { kind: "starred" } | { kind: "trash" } | { kind: "folder"; id: string } | { kind: "tag"; tag: string };
/** Map dashboard UI state to the server-side GET /documents query (search, sort and paging are server-side). */
export function toQuery(view: View, q: string, sort: SortKey, cursor?: string): ListQuery {
  const [field, order] = ({ updated_desc: ["updated_at", "desc"], created_desc: ["created_at", "desc"], created_asc: ["created_at", "asc"], name_asc: ["name", "asc"], name_desc: ["name", "desc"] } as const)[sort];
  const out: ListQuery = { sort: field, order, limit: 50 };
  if (q.trim()) out.q = q.trim();
  if (view.kind === "starred") out.starred = true;
  if (view.kind === "trash") out.trashed = true;
  if (view.kind === "folder") out.folder_id = view.id;
  if (view.kind === "tag") out.tag = view.tag;
  if (cursor) out.cursor = cursor;
  return out;
}
/** Tags must match the backend's a-z0-9_- rule. */
export function parseTags(input: string): string[] {
  return [...new Set(input.split(/[,\s]+/).map((t) => t.trim().toLowerCase()).filter((t) => /^[a-z0-9_-]+$/.test(t)))];
}
