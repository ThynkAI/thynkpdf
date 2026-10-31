"use client";
import { useEffect, useRef } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useViewerStore } from "./store";
import { PageView } from "./PageView";

const THUMB_W = 120;
export function Thumbnails() {
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
    <div ref={ref} className="h-full overflow-auto py-2" aria-label="Page thumbnails" data-testid="thumbnails">
      {doc && (
        <div style={{ height: v.getTotalSize(), position: "relative" }}>
          {v.getVirtualItems().map((it) => {
            const s = pageSizes[it.index]; const scale = THUMB_W / s.width;
            const active = it.index === currentPage;
            return (
              <button key={`${docKey}-${it.index}`} type="button" onClick={() => goToPage(it.index)} aria-current={active ? "page" : undefined}
                aria-label={`Go to page ${it.index + 1}`}
                className={`absolute left-0 right-0 mx-auto flex flex-col items-center gap-1 rounded p-1 text-xs ${active ? "bg-brand-500/20 ring-2 ring-brand-500" : "hover:bg-neutral-200 dark:hover:bg-neutral-800"}`}
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
