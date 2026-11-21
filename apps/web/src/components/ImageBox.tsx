"use client";
import { useRef } from "react";
import { RotateCw, Trash2 } from "lucide-react";
import { useImages, setGeo, commitTransform, removeImage, transform } from "@/lib/imageState";
import type { Placed } from "@/lib/images";

type Geo = Pick<Placed, "left" | "top" | "width" | "height" | "rotation">;
const geo = (p: Placed): Geo => ({ left: p.left, top: p.top, width: p.width, height: p.height, rotation: p.rotation });

/** Placed images on one page: drag to move, corner to resize (Shift = free aspect), top knob to rotate (Shift = 15° steps). */
export function ImageLayer({ pageIndex, scale }: { pageIndex: number; scale: number }) {
  const { items, selected } = useImages();
  const mine = items.filter((x) => x.page === pageIndex);
  if (!mine.length) return null;
  return <>{mine.map((p) => <ImageBox key={p.id} p={p} scale={scale} on={selected === p.id} />)}</>;
}

function ImageBox({ p, scale, on }: { p: Placed; scale: number; on: boolean }) {
  const drag = useRef<{ mode: "move" | "resize" | "rotate"; x: number; y: number; g: Geo; cx: number; cy: number } | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const start = (mode: "move" | "resize" | "rotate") => (e: React.PointerEvent) => {
    e.stopPropagation(); e.preventDefault(); (e.currentTarget as Element).setPointerCapture(e.pointerId);
    useImages.getState().set({ selected: p.id });
    const r = box.current!.getBoundingClientRect();
    drag.current = { mode, x: e.clientX, y: e.clientY, g: geo(p), cx: r.left + r.width / 2, cy: r.top + r.height / 2 };
  };
  const move = (e: React.PointerEvent) => {
    const d = drag.current; if (!d) return;
    const dx = (e.clientX - d.x) / scale, dy = (e.clientY - d.y) / scale;
    if (d.mode === "move") setGeo(p.id, { left: d.g.left + dx, top: d.g.top + dy });
    else if (d.mode === "resize") {
      const w = Math.max(12, d.g.width + dx);
      const h = e.shiftKey ? Math.max(12, d.g.height + dy) : (w * d.g.height) / d.g.width;
      setGeo(p.id, { width: w, height: h });
    } else {
      let a = (Math.atan2(e.clientY - d.cy, e.clientX - d.cx) * 180) / Math.PI + 90;
      if (e.shiftKey) a = Math.round(a / 15) * 15;
      setGeo(p.id, { rotation: Math.round(((a % 360) + 360) % 360) });
    }
  };
  const end = () => {
    const d = drag.current; if (!d) return; drag.current = null;
    const cur = useImages.getState().items.find((x) => x.id === p.id); if (!cur) return;
    commitTransform(p.id, d.g, geo(cur), d.mode === "move" ? "Move image" : d.mode === "resize" ? "Resize image" : "Rotate image");
  };
  const onKey = (e: React.KeyboardEvent) => {
    const st = e.shiftKey ? 10 : 2;
    const m: Record<string, [number, number]> = { ArrowLeft: [-st, 0], ArrowRight: [st, 0], ArrowUp: [0, -st], ArrowDown: [0, st] };
    if (m[e.key]) { e.preventDefault(); e.stopPropagation(); transform(p.id, { left: p.left + m[e.key][0], top: p.top + m[e.key][1] }, "Move image"); }
    else if (e.key === "+" || e.key === "-") { e.preventDefault(); e.stopPropagation(); const k = e.key === "+" ? 1.1 : 0.9; transform(p.id, { width: Math.max(12, p.width * k), height: Math.max(12, p.height * k) }, "Resize image"); }
    else if (e.key === "r" || e.key === "R") { e.preventDefault(); e.stopPropagation(); transform(p.id, { rotation: (p.rotation + (e.shiftKey ? 270 : 90)) % 360 }, "Rotate image"); }
    else if (e.key === "Delete" || e.key === "Backspace") { e.preventDefault(); e.stopPropagation(); removeImage(p.id); }
  };
  return (
    <div ref={box} role="img" tabIndex={0} aria-label={`Placed image ${p.img.name}${on ? " (selected)" : ""}: arrows move, +/- resize, R rotates, Delete removes`}
      data-testid="image-box" data-selected={on || undefined} onKeyDown={onKey} onFocus={() => useImages.getState().set({ selected: p.id })}
      onPointerDown={start("move")} onPointerMove={move} onPointerUp={end}
      className={`tp-image-box absolute z-[7] cursor-move touch-none select-none ${on ? "outline outline-2 outline-[#E8141C]" : "outline-dashed outline-1 outline-neutral-500 hover:outline-[#E8141C]"}`}
      style={{ left: p.left * scale, top: p.top * scale, width: p.width * scale, height: p.height * scale, transform: `rotate(${p.rotation}deg)` }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={p.img.url} alt="" draggable={false} className="pointer-events-none h-full w-full" />
      {on && <>
        <span data-testid="image-rotate" aria-hidden title="Drag to rotate (Shift: 15° steps)" onPointerDown={start("rotate")} onPointerMove={move} onPointerUp={end}
          className="absolute -top-7 left-1/2 grid h-5 w-5 -translate-x-1/2 cursor-grab place-items-center rounded-full border-2 border-white bg-[#E8141C] text-white shadow"><RotateCw className="h-3 w-3" /></span>
        <span data-testid="image-resize" aria-hidden title="Drag to resize (Shift: free aspect)" onPointerDown={start("resize")} onPointerMove={move} onPointerUp={end}
          className="absolute -bottom-2 -right-2 h-4 w-4 cursor-nwse-resize rounded-full border-2 border-white bg-[#E8141C] shadow" />
        <button type="button" aria-label="Delete placed image" title="Delete (Del)" onPointerDown={(e) => e.stopPropagation()} onClick={(e) => { e.stopPropagation(); removeImage(p.id); }}
          className="absolute -right-3 -top-3 grid h-6 w-6 place-items-center rounded-full bg-ink text-white shadow hover:bg-[#E8141C]"><Trash2 className="h-3.5 w-3.5" /></button>
        <span className="pointer-events-none absolute -bottom-6 left-0 whitespace-nowrap rounded bg-ink/80 px-1 text-[10px] text-white">{Math.round(p.width)}×{Math.round(p.height)} pt · {p.rotation}°</span>
      </>}
    </div>
  );
}
