"use client";
import { useEffect, useState, type ReactNode } from "react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { openPdf, PageView } from "@thynkpdf/pdf-viewer/client";
import { pdfToDisplay, type PageGeom } from "@/lib/geometry";

/** Simple read-only page list for public pages (signer link, shared link). `overlay` draws boxes given a PDF→display mapper. */
export function PdfPages({ url, width = 640, overlay }: { url: string; width?: number; overlay?: (page: number, map: (x: number, y: number) => [number, number], scale: number) => ReactNode }) {
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null);
  const [geoms, setGeoms] = useState<PageGeom[]>([]);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    let live = true; let d: PDFDocumentProxy | null = null;
    openPdf({ url }).then(async (r) => {
      d = r.doc;
      const g = await Promise.all(Array.from({ length: r.doc.numPages }, async (_, i) => { const p = await r.doc.getPage(i + 1); const [x0, y0, x1, y1] = p.view; return { width: x1 - x0, height: y1 - y0, rotation: p.rotate, x0, y0 }; }));
      if (live) { setDoc(r.doc); setGeoms(g); } else void r.doc.destroy();
    }, (e) => live && setErr((e as Error).message));
    return () => { live = false; void d?.destroy(); };
  }, [url]);
  if (err) return <p role="alert" className="text-sm text-red-600">Could not load the document: {err}</p>;
  if (!doc) return <p className="text-sm">Loading document…</p>;
  return (
    <div className="flex flex-col items-center gap-4">
      {geoms.map((g, i) => {
        const rot = g.rotation % 180 !== 0; const dw = rot ? g.height : g.width, dh = rot ? g.width : g.height;
        const scale = Math.min(width, dw) / dw;
        return (
          <div key={i} className="relative shadow" style={{ width: dw * scale, height: dh * scale }}>
            <PageView doc={doc} pageIndex={i} scale={scale} width={Math.round(dw * scale)} height={Math.round(dh * scale)} textLayer={false} label={`Page ${i + 1}`} />
            {overlay?.(i + 1, (x, y) => pdfToDisplay(x, y, g, scale), scale)}
          </div>);
      })}
    </div>
  );
}
