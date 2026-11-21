"use client";
/**
 * Redaction marks (review list) and the apply flow. Marks live in memory until "Apply redactions"; the THYNKPDF engine
 * then REMOVES the text, vector graphics and image pixels under each mark (POST /pdf/redact/apply) — nothing is just
 * covered. Adding/removing marks is undoable (Ctrl+Z) like other edits.
 */
import { create } from "zustand";
import type { RedactMarkIn, RedactMatch, RedactImage, SanitizeOptions, RedactPattern } from "@thynkpdf/editor-client";
import { useViewerStore } from "@thynkpdf/pdf-viewer";
import { record, clearHistory } from "./history";
import { useSession } from "./session";
import type { Rect } from "./geometry";

export type MarkKind = "area" | "text" | "search" | "image" | "page";
export type RedactTool = "area" | "text" | "image" | null;
/** page is 0-based; rect is PDF user space (x, y = bottom-left), null = whole page. */
export interface RedactMark { id: string; page: number; rect: Rect | null; kind: MarkKind; label: string }
export interface RedactState {
  docId: string | null; marks: RedactMark[]; selected: string[]; tool: RedactTool;
  images: RedactImage[] | null; imagesFor: string | null;
  set(p: Partial<RedactState>): void;
}
export const useRedact = create<RedactState>((set) => ({ docId: null, marks: [], selected: [], tool: null, images: null, imagesFor: null, set: (p) => set(p) }));

let seq = 0;
export const newMarkId = () => `rd${Date.now().toString(36)}${(seq++).toString(36)}`;

export const PATTERN_LABELS: Record<RedactPattern, string> = {
  email: "Email addresses", phone: "Phone numbers", ssn: "US SSNs", sin: "Canadian SINs", credit_card: "Card numbers", postal_code: "Postal codes (CA)", date: "Dates",
};

/** Marks → API body (1-based pages, [x0, y0, x1, y1]). Pure; unit-tested. */
export function toApiMarks(marks: RedactMark[]): RedactMarkIn[] {
  return marks.map((m) => m.rect ? { page: m.page + 1, rect: [m.rect.x, m.rect.y, m.rect.x + m.rect.width, m.rect.y + m.rect.height] as [number, number, number, number] } : { page: m.page + 1, whole_page: true });
}
/** Search results → marks (one per line box). Pure; unit-tested. */
export function matchesToMarks(matches: RedactMatch[]): RedactMark[] {
  return matches.flatMap((m) => m.rects.map(([x0, y0, x1, y1]) => ({
    id: newMarkId(), page: m.page - 1, rect: { x: x0, y: y0, width: x1 - x0, height: y1 - y0 }, kind: "search" as const, label: m.text.slice(0, 80),
  })));
}
/** Same page + (nearly) same box = duplicate. Pure; unit-tested. */
export function dedupe(existing: RedactMark[], add: RedactMark[]): RedactMark[] {
  const key = (m: RedactMark) => m.rect ? `${m.page}:${Math.round(m.rect.x)}:${Math.round(m.rect.y)}:${Math.round(m.rect.width)}:${Math.round(m.rect.height)}` : `${m.page}:page`;
  const seen = new Set(existing.map(key)); const out: RedactMark[] = [];
  for (const m of add) { const k = key(m); if (!seen.has(k)) { seen.add(k); out.push(m); } }
  return out;
}
export function summary(marks: RedactMark[]) {
  const pages = new Set(marks.map((m) => m.page)).size;
  return `${marks.length} mark${marks.length === 1 ? "" : "s"} on ${pages} page${pages === 1 ? "" : "s"}`;
}

const docNow = () => useSession.getState().ref?.document_id ?? null;
/** Keep marks bound to the open document; a different document starts with an empty list. */
export function syncDoc() {
  const d = docNow(); const s = useRedact.getState();
  if (s.docId !== d) s.set({ docId: d, marks: [], selected: [], images: null, imagesFor: null });
}

export function addMarks(add: RedactMark[], label = "Mark for redaction") {
  syncDoc();
  const s = useRedact.getState(); const fresh = dedupe(s.marks, add);
  if (!fresh.length) return 0;
  const doc = s.docId; const ids = new Set(fresh.map((m) => m.id));
  s.set({ marks: [...s.marks, ...fresh], selected: [] });
  record({ label,
    undo: async () => { const t = useRedact.getState(); if (t.docId !== doc) return false; t.set({ marks: t.marks.filter((m) => !ids.has(m.id)), selected: [] }); },
    redo: async () => { const t = useRedact.getState(); if (t.docId !== doc) return false; t.set({ marks: [...t.marks, ...fresh.filter((m) => !t.marks.some((x) => x.id === m.id))] }); } });
  return fresh.length;
}
export function removeMarks(ids: string[], label = "Remove redaction mark") {
  const s = useRedact.getState(); const gone = s.marks.filter((m) => ids.includes(m.id));
  if (!gone.length) return 0;
  const doc = s.docId;
  s.set({ marks: s.marks.filter((m) => !ids.includes(m.id)), selected: s.selected.filter((i) => !ids.includes(i)) });
  record({ label,
    undo: async () => { const t = useRedact.getState(); if (t.docId !== doc) return false; t.set({ marks: [...t.marks, ...gone] }); },
    redo: async () => { const t = useRedact.getState(); if (t.docId !== doc) return false; t.set({ marks: t.marks.filter((m) => !ids.includes(m.id)) }); } });
  return gone.length;
}
export const deleteSelectedMarks = () => removeMarks(useRedact.getState().selected, "Delete redaction marks");
export const clearMarks = () => removeMarks(useRedact.getState().marks.map((m) => m.id), "Clear redaction marks");

export function markWholePages(pages: number[]) {
  return addMarks(pages.map((p) => ({ id: newMarkId(), page: p, rect: null, kind: "page" as const, label: `Whole page ${p + 1}` })), "Mark page for redaction");
}

/** Text selection in the page text layer → one mark per selected line box (selection is then cleared). */
export async function markTextSelection(): Promise<number> {
  const sel = window.getSelection(); if (!sel || sel.isCollapsed || !sel.rangeCount) return 0;
  const { getGeom } = await import("./pageGeom"); const { displayBoxToPdfRect } = await import("./geometry");
  const rects = Array.from(sel.getRangeAt(0).getClientRects()).filter((r) => r.width > 0.5 && r.height > 0.5);
  const pages = Array.from(document.querySelectorAll<HTMLElement>(".tp-viewer .tp-page"));
  const scale = useViewerStore.getState().effectiveScale; const text = sel.toString().replace(/\s+/g, " ").trim();
  const out: RedactMark[] = [];
  for (const r of rects) {
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    const pg = pages.find((p) => { const b = p.getBoundingClientRect(); return cx >= b.left && cx <= b.right && cy >= b.top && cy <= b.bottom; });
    if (!pg) continue;
    const idx = Number(pg.dataset.page) - 1; const g = await getGeom(idx); if (!g) continue;
    const b = pg.getBoundingClientRect();
    out.push({ id: newMarkId(), page: idx, rect: displayBoxToPdfRect(r.left - b.left, r.top - b.top, r.width, r.height, g, scale), kind: "text", label: text.slice(0, 80) || "Selected text" });
  }
  sel.removeAllRanges();
  return addMarks(out, "Mark selected text for redaction");
}

/** Image placements of the open document (cached per version) for "click an image to mark it". */
export async function loadImages(): Promise<RedactImage[]> {
  const s = useSession.getState(); const ref = s.ref; if (!ref) return [];
  const key = `${ref.document_id}@${ref.version}`; const st = useRedact.getState();
  if (st.imagesFor === key && st.images) return st.images;
  const { http } = await import("./documents");
  const r = await http().redactImages(ref.document_id, ref.version);
  useRedact.getState().set({ images: r.images, imagesFor: key });
  return r.images;
}
export function markImage(img: RedactImage) {
  const [x0, y0, x1, y1] = img.rect;
  return addMarks([{ id: newMarkId(), page: img.page - 1, rect: { x: x0, y: y0, width: x1 - x0, height: y1 - y0 }, kind: "image", label: `Image${img.width ? ` ${img.width}×${img.height}px` : ""}` }], "Mark image for redaction");
}

export interface ApplyOptions { fill: "black" | "none"; sanitize: SanitizeOptions | null; output: "new_document" | "new_version"; filename?: string }
export const DEFAULT_SANITIZE: Required<SanitizeOptions> = { metadata: true, javascript: true, attachments: true, comments: true, forms: false, hidden_text: false };

/** Apply: engine removes content; default output is a NEW document which is then opened. Returns the report or null. */
export async function applyRedactions(o: ApplyOptions): Promise<Record<string, unknown> | null> {
  const s = useSession.getState(); const ref = s.ref; if (!ref) return null;
  const marks = useRedact.getState().marks;
  const { http, describeError, openLatest, runVersionedOp } = await import("./documents");
  const body = { marks: toApiMarks(marks), fill: o.fill, sanitize: o.sanitize, output: o.output, ...(o.filename ? { filename: o.filename } : {}) };
  if (o.output === "new_version") {
    const ok = await runVersionedOp("Apply redactions", (r) => http().redactApply(r, body));
    if (!ok) return null;
    const rep = (await import("./documents")).lastReport ?? {};
    useRedact.getState().set({ marks: [], selected: [], docId: useSession.getState().ref?.document_id ?? null });
    s.set({ notice: reportText(rep, "Saved as a new version of this document. Earlier versions still contain the original content — delete them from Documents → Versions if needed.") });
    return rep;
  }
  s.set({ busy: "Applying redactions…", error: null, notice: null });
  try {
    const r = await http().redactApply(ref, body);
    await openLatest(r.document_id);
    clearHistory(); // the history belonged to the source document
    useRedact.getState().set({ docId: r.document_id, marks: [], selected: [], images: null, imagesFor: null });
    s.set({ notice: reportText(r.report ?? {}, `Saved as “${r.filename}”. The original document is unchanged.`) });
    return r.report ?? {};
  } catch (e) { s.set({ error: `Apply redactions failed: ${describeError(e)}` }); return null; }
  finally { s.set({ busy: null }); }
}

/** Human summary of the engine report. Pure; unit-tested. */
export function reportText(rep: Record<string, unknown>, tail: string) {
  const n = (k: string) => Number(rep[k] ?? 0);
  const parts = [
    n("glyphs_removed") && `${n("glyphs_removed")} characters`,
    (n("images_redacted") + n("images_removed") + n("inline_images_removed")) && `${n("images_redacted") + n("images_removed") + n("inline_images_removed")} image${n("images_redacted") + n("images_removed") + n("inline_images_removed") === 1 ? "" : "s"}`,
    n("paths_removed") && `${n("paths_removed")} drawing${n("paths_removed") === 1 ? "" : "s"}`,
    n("annotations_removed") && `${n("annotations_removed")} annotation${n("annotations_removed") === 1 ? "" : "s"}`,
    Array.isArray(rep.whole_pages) && (rep.whole_pages as number[]).length && `${(rep.whole_pages as number[]).length} whole page${(rep.whole_pages as number[]).length === 1 ? "" : "s"}`,
  ].filter(Boolean);
  const hidden = rep.sanitized && typeof rep.sanitized === "object" ? " Hidden information removed." : "";
  return `Redaction applied: removed ${parts.length ? parts.join(", ") : "the marked content"}.${hidden} ${tail}`;
}
