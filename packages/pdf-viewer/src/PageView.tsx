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
  /** index (in reading order) of the active search hit on this page, or -1 */
  activeHit?: number;
  textLayer?: boolean;
  label?: string;
}

/** External links in XFA forms open in a new tab without opener; PDF-internal navigation isn't needed here. */
const xfaLinkService = {
  addLinkAttributes(link: HTMLAnchorElement, url: string) { link.href = url; link.rel = "noopener noreferrer nofollow"; link.target = "_blank"; },
  getDestinationHash: () => "#", getAnchorUrl: () => "#", executeNamedAction() {}, executeSetOCGState() {}, navigateTo() {}, goToDestination() {},
};

function applyHighlights(divs: HTMLElement[], strs: string[], query: string, active = -1) {
  let n = 0;
  divs.forEach((div, i) => {
    const s = strs[i] ?? div.textContent ?? "";
    const segs = highlightSegments(s, query);
    if (segs.length === 1 && !segs[0].hit) { if (div.childElementCount) div.textContent = s; return; }
    div.textContent = "";
    for (const seg of segs) {
      if (seg.hit) { const m = document.createElement("mark"); m.className = n === active ? "tp-hit tp-hit-active" : "tp-hit"; n++; m.textContent = seg.text; div.appendChild(m); }
      else div.appendChild(document.createTextNode(seg.text));
    }
  });
}

export function PageView({ doc, pageIndex, scale, width, height, query = "", activeHit = -1, textLayer = true, label }: PageViewProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const textRef = useRef<HTMLDivElement>(null);
  const xfaRef = useRef<HTMLDivElement>(null);
  const isXfa = !!doc.isPureXfa;
  const textDivs = useRef<{ divs: HTMLElement[]; strs: string[] }>({ divs: [], strs: [] });
  const queryRef = useRef({ query, activeHit });
  queryRef.current = { query, activeHit };

  useEffect(() => {
    let cancelled = false;
    let task: RenderTask | null = null;
    let tl: { cancel(): void } | null = null;
    (async () => {
      const page = await doc.getPage(pageIndex + 1);
      if (cancelled || (!isXfa && !canvasRef.current)) return;
      const viewport = page.getViewport({ scale });
      if (isXfa) {
        // Dynamic XFA: PDF.js lays the form out as HTML (XfaLayer). Inputs read/write doc.annotationStorage, which
        // saveDocument() serializes into the XFA datasets. The canvas has nothing to draw for these pages.
        const xfaHtml = await page.getXfa();
        const div = xfaRef.current;
        if (cancelled || !div || !xfaHtml) return;
        const { XfaLayer } = await getPdfjs();
        div.replaceChildren();
        XfaLayer.render({ viewport: viewport.clone({ dontFlip: true }), div, xfaHtml, annotationStorage: doc.annotationStorage, linkService: xfaLinkService, intent: textLayer ? "display" : "print" } as unknown as Parameters<typeof XfaLayer.render>[0]);
        if (!textLayer) div.querySelectorAll("input,textarea,select,button").forEach((el) => { (el as HTMLInputElement).disabled = true; el.setAttribute("tabindex", "-1"); });
        return;
      }
      const canvas = canvasRef.current!;
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
      applyHighlights(textDivs.current.divs, textDivs.current.strs, queryRef.current.query, queryRef.current.activeHit);
      container.querySelector(".tp-hit-active")?.scrollIntoView({ block: "center" });
    })();
    return () => { cancelled = true; task?.cancel(); tl?.cancel(); };
  }, [doc, pageIndex, scale, textLayer, isXfa]);

  useEffect(() => {
    applyHighlights(textDivs.current.divs, textDivs.current.strs, query, activeHit);
    if (activeHit >= 0) textRef.current?.querySelector(".tp-hit-active")?.scrollIntoView({ block: "center" });
  }, [query, activeHit]);

  return (
    <div className="tp-page relative bg-white shadow-md" style={{ width, height }} data-page={pageIndex + 1} aria-label={label ?? `Page ${pageIndex + 1}`} role="region">
      {isXfa ? <div ref={xfaRef} className="xfaLayer" data-testid="xfa-layer" style={{ position: "absolute", inset: 0 }} />
        : <canvas ref={canvasRef} style={{ width, height, display: "block" }} />}
      {textLayer && !isXfa && <div ref={textRef} className="textLayer" />}
    </div>
  );
}
