"use client";
import { useRef } from "react";
import { useSignature } from "@/lib/signature";

/** Draggable/resizable placed signature over a page. Geometry stored in PDF points so zoom doesn't move it. */
export function SignatureBox({ pageIndex, scale }: { pageIndex: number; scale: number }) {
  const { image, placement, set } = useSignature();
  const drag = useRef<{ mode: "move" | "resize"; x: number; y: number; p: NonNullable<typeof placement> } | null>(null);
  if (!image || !placement || placement.page !== pageIndex) return null;
  const onDown = (mode: "move" | "resize") => (e: React.PointerEvent) => {
    e.stopPropagation(); e.preventDefault(); (e.target as Element).setPointerCapture(e.pointerId);
    drag.current = { mode, x: e.clientX, y: e.clientY, p: placement };
  };
  const onMove = (e: React.PointerEvent) => {
    const d = drag.current; if (!d) return;
    const dx = (e.clientX - d.x) / scale, dy = (e.clientY - d.y) / scale;
    if (d.mode === "move") set({ placement: { ...d.p, left: d.p.left + dx, top: d.p.top + dy } });
    else { const w = Math.max(24, d.p.width + dx); set({ placement: { ...d.p, width: w, height: w / image.aspect } }); }
  };
  const onKey = (e: React.KeyboardEvent) => {
    const step = e.shiftKey ? 10 : 2;
    const m: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    if (m[e.key]) { e.preventDefault(); e.stopPropagation(); set({ placement: { ...placement, left: placement.left + m[e.key][0], top: placement.top + m[e.key][1] } }); }
    if (e.key === "+" || e.key === "-") { e.preventDefault(); e.stopPropagation(); const w = Math.max(24, placement.width * (e.key === "+" ? 1.1 : 0.9)); set({ placement: { ...placement, width: w, height: w / image.aspect } }); }
  };
  return (
    <div role="img" aria-label="Placed signature (arrow keys move, +/- resize)" tabIndex={0} data-testid="sig-box" onKeyDown={onKey}
      onPointerDown={onDown("move")} onPointerMove={onMove} onPointerUp={() => { drag.current = null; }}
      className="absolute z-10 cursor-move outline-dashed outline-2 outline-brand-500 focus-visible:outline-4"
      style={{ left: placement.left * scale, top: placement.top * scale, width: placement.width * scale, height: placement.height * scale }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={image.dataUrl} alt="" draggable={false} className="pointer-events-none h-full w-full select-none" />
      <span data-testid="sig-resize" aria-hidden="true" onPointerDown={onDown("resize")} onPointerMove={onMove} onPointerUp={() => { drag.current = null; }}
        className="absolute -bottom-2 -right-2 h-4 w-4 cursor-nwse-resize rounded-full border-2 border-white bg-brand-600" />
    </div>
  );
}
