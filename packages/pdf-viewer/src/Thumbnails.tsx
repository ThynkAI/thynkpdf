"use client";
import { useEffect, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useViewerStore } from "./store";
import { PageView } from "./PageView";

const THUMB_W = 120;
export interface ThumbnailsProps {
  /** Called with 0-based from/to when the user drops a thumbnail. Omit to disable drag. */
  onReorder?: (from: number, to: number) => void;
  /** When set, drag is disabled and this reason is shown as the tooltip. */
  reorderDisabledReason?: string | null;
}
export function Thumbnails({ onReorder, reorderDisabledReason }: ThumbnailsProps = {}) {
  const [drag, setDrag] = useState<number | null>(null);
  const [over, setOver] = useState<number | null>(null);
  const canDrag = !!onReorder && !reorderDisabledReason;
  const { doc, docKey, pageSizes, currentPage, goToPage, matches } = useViewerStore();
  const ref = useRef<HTMLDivElement>(null);
  const v = useVirtualizer({
    count: pageSizes.length, getScrollElement: () => ref.current, overscan: 3,
    estimateSize: (i) => Math.round((pageSizes[i].height * THUMB_W) / pageSizes[i].width) + 32,
  });
  useEffect(() => { v.measure(); }, [docKey, pageSizes, v]);
  useEffect(() => { if (pageSizes.length) v.scrollToIndex(currentPage, { align: "auto" }); }, [currentPage, pageSizes.length, v]);
  const hitPages = new Set(matches.map((m) => m.page));
  return (
    <div ref={ref} role="region" className="h-full overflow-auto py-2" aria-label="Page thumbnails" data-testid="thumbnails">
      {doc && (
        <div style={{ height: v.getTotalSize(), position: "relative" }}>
          {v.getVirtualItems().map((it) => {
            const s = pageSizes[it.index]; const scale = THUMB_W / s.width;
            const active = it.index === currentPage;
            return (
              <button key={`${docKey}-${it.index}`} type="button" onClick={() => goToPage(it.index)} aria-current={active ? "page" : undefined}
                aria-label={`Go to page ${it.index + 1}`}
                title={onReorder ? (reorderDisabledReason ?? "Drag, or Alt+↑/↓, to reorder") : undefined}
                draggable={canDrag} data-testid={`thumb-${it.index + 1}`}
                onDragStart={(e) => { if (!canDrag) return; e.stopPropagation(); e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("application/x-thynkpdf-page", String(it.index)); setDrag(it.index); }}
                onDragOver={(e) => { if (drag === null) return; e.preventDefault(); e.stopPropagation(); setOver(it.index); }}
                onDrop={(e) => { if (drag === null) return; e.preventDefault(); e.stopPropagation(); const from = drag; setDrag(null); setOver(null); if (from !== it.index) onReorder?.(from, it.index); }}
                onDragEnd={() => { setDrag(null); setOver(null); }}
                onKeyDown={(e) => {
                  if (!canDrag || !e.altKey || (e.key !== "ArrowUp" && e.key !== "ArrowDown")) return;
                  e.preventDefault(); e.stopPropagation();
                  const to = it.index + (e.key === "ArrowUp" ? -1 : 1);
                  if (to >= 0 && to < pageSizes.length) onReorder?.(it.index, to);
                }}
                className={`absolute left-0 right-0 mx-auto flex flex-col items-center gap-1 rounded p-1 text-xs ${over === it.index && drag !== it.index ? "outline outline-2 outline-dashed outline-brand-500 " : ""}${drag === it.index ? "opacity-50 " : ""}${active ? "bg-brand-500/20 ring-2 ring-brand-500" : "hover:bg-neutral-200 dark:hover:bg-neutral-800"}`}
                style={{ top: it.start, width: THUMB_W + 12 }}>
                <PageView doc={doc} pageIndex={it.index} scale={scale} width={THUMB_W} height={Math.round(s.height * scale)} textLayer={false} label={`Thumbnail ${it.index + 1}`} />
                <span className={hitPages.has(it.index) ? "font-semibold text-amber-600" : ""}>{it.index + 1}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
