"use client";
import { useEffect, useRef, useState } from "react";
import { useAnnot, MARKUP } from "@/lib/annotState";
import { authorName, annotate, eraseAnnotation } from "@/lib/annotActions";
import type { NewAnnot, ParsedAnnot } from "@/lib/annotWrite";
import { displayToPdf, displayBoxToPdfRect, pdfToDisplay, type PageGeom } from "@/lib/geometry";
import { getGeom } from "@/lib/pageGeom";

type P = [number, number];
const DRAG_TOOLS = ["ink", "square", "circle", "line", "arrow", "callout"];

/** Pointer layer over one page for drawing tools. Markup tools (highlight etc.) use the text selection instead. */
export function AnnotOverlay({ pageIndex, scale }: { pageIndex: number; scale: number }) {
  const { tool, color, stamp, text, all } = useAnnot();
  const [geom, setGeom] = useState<PageGeom | null>(null);
  const [pts, setPts] = useState<P[]>([]);
  const ref = useRef<HTMLDivElement>(null);
  const down = useRef(false);
  useEffect(() => { void getGeom(pageIndex).then(setGeom); }, [pageIndex]);
  if (tool === "none" && geom) return <SelectLayer pageIndex={pageIndex} scale={scale} geom={geom} all={all} />;
  if (tool === "none" || MARKUP.includes(tool) || !geom) return null;

  const local = (e: React.PointerEvent): P => { const r = ref.current!.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
  const toPdf = (p: P) => displayToPdf(p[0], p[1], geom, scale);
  const base = () => ({ page: pageIndex, author: authorName(), color, contents: text.trim() || undefined });
  const commit = (a: NewAnnot) => annotate([a]);
  const box = (c: P, w: number, h: number) => displayBoxToPdfRect(c[0], c[1], w * scale, h * scale, geom, scale);

  const onDown = (e: React.PointerEvent) => {
    e.preventDefault(); const p = local(e);
    if (DRAG_TOOLS.includes(tool)) { down.current = true; ref.current!.setPointerCapture(e.pointerId); setPts([p]); return; }
    if (tool === "note") void commit({ ...base(), type: "note", at: toPdf(p), contents: text.trim() || "Note" });
    else if (tool === "freetext") void commit({ ...base(), type: "freetext", rect: box(p, 180, 36), text: text.trim() || "Comment" });
    else if (tool === "stamp") void commit({ ...base(), type: "stamp", rect: box([p[0] - 75 * scale, p[1] - 22 * scale], 150, 44), label: stamp });
    else if (tool === "eraser") {
      const [x, y] = toPdf(p);
      const hit = [...all].reverse().find((a) => a.page === pageIndex && !a.inReplyTo && x >= a.rect.x && x <= a.rect.x + a.rect.width && y >= a.rect.y && y <= a.rect.y + a.rect.height);
      if (hit) void eraseAnnotation(hit.id);
    }
  };
  const onMove = (e: React.PointerEvent) => {
    if (!down.current) return; const p = local(e);
    setPts((q) => (tool === "ink" ? [...q, p] : [q[0], p]));
  };
  const onUp = () => {
    if (!down.current) return; down.current = false;
    const q = pts; setPts([]);
    if (q.length < 2 && tool !== "ink") return;
    const [a, b] = [q[0], q[q.length - 1]];
    const rectOf = () => displayBoxToPdfRect(Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.abs(a[0] - b[0]) || 1, Math.abs(a[1] - b[1]) || 1, geom, scale);
    if (tool === "ink") void commit({ ...base(), type: "ink", paths: [q.map(toPdf)] });
    else if (tool === "square" || tool === "circle") void commit({ ...base(), type: tool, rect: rectOf() });
    else if (tool === "line" || tool === "arrow") void commit({ ...base(), type: tool, from: toPdf(a), to: toPdf(b) });
    else if (tool === "callout") void commit({ ...base(), type: "callout", anchor: toPdf(a), rect: box(b, 180, 36), text: text.trim() || "Callout" });
  };
  const css = `rgb(${color.map((c) => Math.round(c * 255)).join(",")})`;
  const a = pts[0], b = pts[pts.length - 1];
  const erasable = tool === "eraser" ? all.filter((x) => x.page === pageIndex && !x.inReplyTo) : [];
  return (
    <div ref={ref} data-testid={`annot-layer-${pageIndex + 1}`} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp}
      className={`absolute inset-0 z-[5] touch-none ${tool === "eraser" ? "cursor-cell" : "cursor-crosshair"}`} aria-label={`Annotation layer page ${pageIndex + 1} (${tool})`}>
      <svg className="pointer-events-none absolute inset-0 h-full w-full" aria-hidden="true">
        {pts.length > 1 && tool === "ink" && <polyline points={pts.map((p) => p.join(",")).join(" ")} fill="none" stroke={css} strokeWidth={2} />}
        {pts.length > 1 && (tool === "square" || tool === "callout") && <rect x={Math.min(a[0], b[0])} y={Math.min(a[1], b[1])} width={Math.abs(a[0] - b[0])} height={Math.abs(a[1] - b[1])} fill="none" stroke={css} strokeDasharray="4" />}
        {pts.length > 1 && tool === "circle" && <ellipse cx={(a[0] + b[0]) / 2} cy={(a[1] + b[1]) / 2} rx={Math.abs(a[0] - b[0]) / 2} ry={Math.abs(a[1] - b[1]) / 2} fill="none" stroke={css} strokeDasharray="4" />}
        {pts.length > 1 && (tool === "line" || tool === "arrow") && <line x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]} stroke={css} strokeWidth={2} />}
        {erasable.map((x) => { const p1 = pdfToDisplay(x.rect.x, x.rect.y, geom, scale), p2 = pdfToDisplay(x.rect.x + x.rect.width, x.rect.y + x.rect.height, geom, scale);
          return <rect key={x.id} x={Math.min(p1[0], p2[0])} y={Math.min(p1[1], p2[1])} width={Math.abs(p1[0] - p2[0])} height={Math.abs(p1[1] - p2[1])} fill="rgba(239,68,68,0.08)" stroke="rgb(239,68,68)" strokeDasharray="3" />; })}
      </svg>
    </div>
  );
}

/**
 * Select tool (the default when no drawing tool is active): every annotation on the page gets a hit box. Click selects it
 * (visible red outline), Shift/Ctrl-click toggles it in a multi-selection; Delete/Backspace, Ctrl+C/X/V act on the selection.
 * Only the annotation boxes take pointer events, so text selection elsewhere on the page keeps working.
 */
function SelectLayer({ pageIndex, scale, geom, all }: { pageIndex: number; scale: number; geom: PageGeom; all: ParsedAnnot[] }) {
  const selected = useAnnot((a) => a.selected);
  const items = all.filter((x) => x.page === pageIndex && !x.inReplyTo && x.subtype !== "Popup");
  if (!items.length) return null;
  return (
    <div className="pointer-events-none absolute inset-0 z-[5]" data-testid={`select-layer-${pageIndex + 1}`}>
      {items.map((x) => {
        const p1 = pdfToDisplay(x.rect.x, x.rect.y, geom, scale), p2 = pdfToDisplay(x.rect.x + x.rect.width, x.rect.y + x.rect.height, geom, scale);
        const pad = 3, on = selected.includes(x.id);
        const left = Math.min(p1[0], p2[0]) - pad, top = Math.min(p1[1], p2[1]) - pad;
        return (
          <button key={x.id} type="button" data-annot-id={x.id} data-selected={on || undefined} aria-pressed={on}
            aria-label={`${x.subtype || "Annotation"}${x.contents ? `: ${x.contents.slice(0, 60)}` : ""}${on ? " (selected)" : ""}`}
            title={on ? "Selected — Delete to remove, Ctrl+C to copy" : "Click to select (Shift-click to add)"}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              const cur = useAnnot.getState().selected;
              const multi = e.shiftKey || e.ctrlKey || e.metaKey;
              useAnnot.getState().set({ selected: multi ? (cur.includes(x.id) ? cur.filter((i) => i !== x.id) : [...cur, x.id]) : [x.id] });
              (document.activeElement as HTMLElement | null)?.blur?.();
            }}
            className={`tp-annot-hit pointer-events-auto absolute rounded-sm ${on ? "outline outline-2 outline-offset-1 outline-[#E8141C] bg-[#E8141C]/10" : "hover:outline hover:outline-1 hover:outline-[#E8141C]/60"}`}
            style={{ left, top, width: Math.abs(p1[0] - p2[0]) + pad * 2, height: Math.abs(p1[1] - p2[1]) + pad * 2 }}>
            {on && <span aria-hidden className="absolute -right-1 -top-1 h-2 w-2 rounded-full bg-[#E8141C]" />}
          </button>);
      })}
    </div>
  );
}

/** Text-markup tools: turn the current text selection into Highlight/Underline/StrikeOut annotations (one per page). */
export async function markupFromSelection(): Promise<boolean> {
  const { tool, color, text } = useAnnot.getState();
  if (!MARKUP.includes(tool)) return false;
  const sel = window.getSelection(); if (!sel || sel.isCollapsed || !sel.rangeCount) return false;
  const rects = Array.from(sel.getRangeAt(0).getClientRects()).filter((r) => r.width > 0.5 && r.height > 0.5);
  const pages = Array.from(document.querySelectorAll<HTMLElement>(".tp-viewer .tp-page"));
  const { useViewerStore } = await import("@thynkpdf/pdf-viewer");
  const scale = useViewerStore.getState().effectiveScale;
  const byPage = new Map<number, { x: number; y: number; width: number; height: number }[]>();
  for (const r of rects) {
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    const pg = pages.find((p) => { const b = p.getBoundingClientRect(); return cx >= b.left && cx <= b.right && cy >= b.top && cy <= b.bottom; });
    if (!pg) continue;
    const idx = Number(pg.dataset.page) - 1; const g = await getGeom(idx); if (!g) continue;
    const b = pg.getBoundingClientRect();
    (byPage.get(idx) ?? byPage.set(idx, []).get(idx)!).push(displayBoxToPdfRect(r.left - b.left, r.top - b.top, r.width, r.height, g, scale));
  }
  if (!byPage.size) return false;
  const list: NewAnnot[] = [...byPage].map(([page, quads]) => ({ page, quads, type: tool as "highlight", author: authorName(), color, contents: text.trim() || sel.toString().slice(0, 200) }));
  sel.removeAllRanges();
  return annotate(list);
}
