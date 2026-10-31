"use client";
import { useEffect, useRef } from "react";
import type { PDFDocumentProxy, RenderTask } from "pdfjs-dist";
import { canvasPixelSize } from "./zoom";
import { highlightSegments } from "./search";
import { getPdfjs } from "./loader";

export interface PageViewProps {
  doc: PDFDocumentProxy;
  pageIndex: number;
  scale: number;
  width: number;
  height: number;
  query?: string;
  textLayer?: boolean;
  label?: string;
}

function applyHighlights(divs: HTMLElement[], strs: string[], query: string) {
  divs.forEach((div, i) => {
    const s = strs[i] ?? div.textContent ?? "";
    const segs = highlightSegments(s, query);
    if (segs.length === 1 && !segs[0].hit) { if (div.childElementCount) div.textContent = s; return; }
    div.textContent = "";
    for (const seg of segs) {
      if (seg.hit) { const m = document.createElement("mark"); m.className = "tp-hit"; m.textContent = seg.text; div.appendChild(m); }
      else div.appendChild(document.createTextNode(seg.text));
    }
  });
}

export function PageView({ doc, pageIndex, scale, width, height, query = "", textLayer = true, label }: PageViewProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const textRef = useRef<HTMLDivElement>(null);
  const textDivs = useRef<{ divs: HTMLElement[]; strs: string[] }>({ divs: [], strs: [] });
  const queryRef = useRef(query);
  queryRef.current = query;

  useEffect(() => {
    let cancelled = false;
    let task: RenderTask | null = null;
    let tl: { cancel(): void } | null = null;
    (async () => {
      const page = await doc.getPage(pageIndex + 1);
      if (cancelled || !canvasRef.current) return;
      const viewport = page.getViewport({ scale });
      const canvas = canvasRef.current;
      const px = canvasPixelSize(viewport.width, viewport.height, window.devicePixelRatio || 1);
      canvas.width = px.width; canvas.height = px.height;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      task = page.render({ canvasContext: ctx, viewport, transform: px.ratio !== 1 ? [px.ratio, 0, 0, px.ratio, 0, 0] : undefined });
      try { await task.promise; } catch { return; }
      if (cancelled || !textLayer || !textRef.current) return;
      const { TextLayer } = await getPdfjs();
      const container = textRef.current;
      container.replaceChildren();
      container.style.setProperty("--scale-factor", String(scale));
      const content = await page.getTextContent();
      if (cancelled) return;
      const layer = new TextLayer({ textContentSource: content, container, viewport });
      tl = layer;
      await layer.render();
      if (cancelled) return;
      textDivs.current = { divs: layer.textDivs as HTMLElement[], strs: content.items.map((it) => ("str" in it ? it.str : "")) };
      applyHighlights(textDivs.current.divs, textDivs.current.strs, queryRef.current);
    })();
    return () => { cancelled = true; task?.cancel(); tl?.cancel(); };
  }, [doc, pageIndex, scale, textLayer]);

  useEffect(() => { applyHighlights(textDivs.current.divs, textDivs.current.strs, query); }, [query]);

  return (
    <div className="tp-page relative bg-white shadow-md" style={{ width, height }} data-page={pageIndex + 1} aria-label={label ?? `Page ${pageIndex + 1}`} role="region">
      <canvas ref={canvasRef} style={{ width, height, display: "block" }} />
      {textLayer && <div ref={textRef} className="textLayer" />}
    </div>
  );
}
