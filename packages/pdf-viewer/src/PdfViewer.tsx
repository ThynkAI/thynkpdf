"use client";
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useViewerStore } from "./store";
import { computeScale } from "./zoom";
import { PageView } from "./PageView";

export const PAGE_GAP = 16;

export interface PdfViewerProps {
  className?: string;
  /** Rendered absolutely over each mounted page (CSS px at `scale`, top-left origin). */
  renderOverlay?: (pageIndex: number, scale: number) => ReactNode;
}
export function PdfViewer({ className, renderOverlay }: PdfViewerProps) {
  const { doc, docKey, pageSizes, zoomMode, customScale, scrollRequest, query, currentPage, matches, activeMatch } = useViewerStore();
  const am = activeMatch >= 0 ? matches[activeMatch] : undefined;
  const setEffectiveScale = useViewerStore((s) => s.setEffectiveScale);
  const setCurrentPage = useViewerStore((s) => s.setCurrentPage);
  const ref = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ width: 0, height: 0 });

  useLayoutEffect(() => {
    const el = ref.current; if (!el) return;
    const ro = new ResizeObserver(() => setBox({ width: el.clientWidth, height: el.clientHeight }));
    ro.observe(el); setBox({ width: el.clientWidth, height: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  const ref0 = pageSizes[currentPage] ?? pageSizes[0];
  const scale = computeScale(zoomMode, customScale, ref0, box);
  useEffect(() => { setEffectiveScale(scale); }, [scale, setEffectiveScale]);

  const v = useVirtualizer({
    count: pageSizes.length,
    getScrollElement: () => ref.current,
    estimateSize: (i) => Math.round(pageSizes[i].height * scale) + PAGE_GAP,
    overscan: 2,
    paddingStart: PAGE_GAP,
  });
  // Preserve relative scroll position across zoom changes.
  const prevScale = useRef(scale);
  useEffect(() => {
    const el = ref.current;
    if (el && prevScale.current !== scale) {
      const ratio = scale / prevScale.current;
      v.measure();
      el.scrollTop = el.scrollTop * ratio;
      prevScale.current = scale;
    }
  }, [scale, v]);
  useEffect(() => { if (ref.current) ref.current.scrollTop = 0; }, [docKey]);
  useEffect(() => { if (scrollRequest) v.scrollToIndex(scrollRequest.page, { align: "start" }); }, [scrollRequest, v]);

  const onScroll = () => {
    const el = ref.current; if (!el) return;
    const probe = el.scrollTop + el.clientHeight / 3;
    const item = v.getVirtualItems().find((it) => it.start <= probe && it.end > probe);
    if (item) setCurrentPage(item.index);
  };

  return (
    <div ref={ref} onScroll={onScroll} className={`tp-viewer relative h-full overflow-auto bg-neutral-200 dark:bg-neutral-900 ${className ?? ""}`} data-testid="viewer-scroll" tabIndex={0} aria-label="Document pages">
      {doc && (
        <div style={{ height: v.getTotalSize(), position: "relative", minWidth: "100%", width: Math.max(...pageSizes.map((p) => p.width)) * scale + 32 }}>
          {v.getVirtualItems().map((it) => {
            const s = pageSizes[it.index];
            const w = Math.round(s.width * scale), h = Math.round(s.height * scale);
            return (
              <div key={`${docKey}-${it.index}`} style={{ position: "absolute", top: it.start, left: 0, right: 0, display: "flex", justifyContent: "center" }}>
                <div className="relative" style={{ width: w, height: h }}>
                  <PageView doc={doc} pageIndex={it.index} scale={scale} width={w} height={h} query={query} activeHit={am && am.page === it.index ? am.index : -1} />
                  {renderOverlay?.(it.index, scale)}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
