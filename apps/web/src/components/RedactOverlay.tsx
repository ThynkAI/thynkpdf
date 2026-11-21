"use client";
import { useEffect, useRef, useState } from "react";
import { useRedact, addMarks, newMarkId, markImage, loadImages } from "@/lib/redact";
import { displayBoxToPdfRect, pdfToDisplay, type PageGeom, type Rect } from "@/lib/geometry";
import { getGeom } from "@/lib/pageGeom";

type P = [number, number];
const HATCH = "repeating-linear-gradient(135deg, rgba(17,17,17,0.55) 0 6px, rgba(232,20,28,0.35) 6px 9px)";

function box(r: Rect, g: PageGeom, scale: number) {
  const a = pdfToDisplay(r.x, r.y, g, scale), b = pdfToDisplay(r.x + r.width, r.y + r.height, g, scale);
  return { left: Math.min(a[0], b[0]), top: Math.min(a[1], b[1]), width: Math.abs(a[0] - b[0]), height: Math.abs(a[1] - b[1]) };
}

/**
 * Redaction marks over one page (red outline + hatch = "will be removed"). Area tool: drag a box. Image tool: click an
 * image outline. Marks are selectable (click / Shift-click) and removed with Delete; Ctrl+Z undoes.
 */
export function RedactOverlay({ pageIndex, scale }: { pageIndex: number; scale: number }) {
  const { marks, selected, tool, images } = useRedact();
  const [geom, setGeom] = useState<PageGeom | null>(null);
  const [drag, setDrag] = useState<[P, P] | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { void getGeom(pageIndex).then(setGeom); }, [pageIndex]);
  useEffect(() => { if (tool === "image") void loadImages().catch(() => undefined); }, [tool]);
  const mine = marks.filter((m) => m.page === pageIndex);
  const pageImages = tool === "image" ? (images ?? []).filter((i) => i.page === pageIndex + 1) : [];
  if (!geom || (!mine.length && !tool)) return null;
  const local = (e: React.PointerEvent): P => { const r = ref.current!.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
  const area = tool === "area";
  const onDown = (e: React.PointerEvent) => { if (!area) return; e.preventDefault(); ref.current!.setPointerCapture(e.pointerId); const p = local(e); setDrag([p, p]); };
  const onMove = (e: React.PointerEvent) => { if (drag) setDrag([drag[0], local(e)]); };
  const onUp = () => {
    if (!drag) return; const [a, b] = drag; setDrag(null);
    const w = Math.abs(a[0] - b[0]), h = Math.abs(a[1] - b[1]); if (w < 3 || h < 3) return;
    addMarks([{ id: newMarkId(), page: pageIndex, rect: displayBoxToPdfRect(Math.min(a[0], b[0]), Math.min(a[1], b[1]), w, h, geom, scale), kind: "area", label: `Area on page ${pageIndex + 1}` }]);
  };
  const select = (id: string, multi: boolean) => {
    const cur = useRedact.getState().selected;
    useRedact.getState().set({ selected: multi ? (cur.includes(id) ? cur.filter((i) => i !== id) : [...cur, id]) : [id] });
  };
  return (
    <div ref={ref} data-testid={`redact-layer-${pageIndex + 1}`} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp}
      aria-label={`Redaction marks, page ${pageIndex + 1}${area ? " (drag to mark an area)" : ""}`}
      className={`absolute inset-0 z-[6] ${area ? "cursor-crosshair touch-none" : "pointer-events-none"}`}>
      {mine.map((m) => {
        const on = selected.includes(m.id);
        const st = m.rect ? box(m.rect, geom, scale) : { left: 0, top: 0, width: "100%", height: "100%" };
        return (
          <button key={m.id} type="button" data-redact-id={m.id} data-selected={on || undefined} aria-pressed={on}
            aria-label={`Redaction mark: ${m.label}${on ? " (selected)" : ""}`} title={on ? "Selected — Delete removes this mark" : `Marked for redaction: ${m.label}`}
            onPointerDown={(e) => e.stopPropagation()} onClick={(e) => { e.stopPropagation(); select(m.id, e.shiftKey || e.ctrlKey || e.metaKey); (document.activeElement as HTMLElement | null)?.blur?.(); }}
            className={`tp-redact-mark pointer-events-auto absolute ${on ? "outline outline-[3px] outline-offset-1 outline-[#E8141C]" : "outline outline-2 outline-[#E8141C]"}`}
            style={{ ...st, background: HATCH, opacity: on ? 0.95 : 0.8 }}>
            {!m.rect && <span className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded bg-[#E8141C] px-2 py-1 text-xs font-semibold text-white">Whole page will be redacted</span>}
          </button>);
      })}
      {pageImages.map((im, i) => {
        const [x0, y0, x1, y1] = im.rect; const st = box({ x: x0, y: y0, width: x1 - x0, height: y1 - y0 }, geom, scale);
        return (
          <button key={`img${i}`} type="button" data-testid="redact-image-target" aria-label={`Mark image ${i + 1} on page ${pageIndex + 1} for redaction`}
            onPointerDown={(e) => e.stopPropagation()} onClick={(e) => { e.stopPropagation(); markImage(im); }}
            className="pointer-events-auto absolute border-2 border-dashed border-[#E8141C] bg-[#E8141C]/5 hover:bg-[#E8141C]/20" style={st}>
            <span className="absolute left-1 top-1 rounded bg-white/90 px-1 text-[10px] font-medium text-[#E8141C]">Click to redact image</span>
          </button>);
      })}
      {drag && (() => { const [a, b] = drag; return <div className="pointer-events-none absolute border-2 border-[#E8141C]" style={{ left: Math.min(a[0], b[0]), top: Math.min(a[1], b[1]), width: Math.abs(a[0] - b[0]), height: Math.abs(a[1] - b[1]), background: HATCH, opacity: 0.6 }} />; })()}
    </div>
  );
}
