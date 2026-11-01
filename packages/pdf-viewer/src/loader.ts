"use client";
import type { PDFDocumentProxy } from "pdfjs-dist";
import type { Size } from "./zoom";
import { classifyXfa, type XfaMode } from "./xfa";
export type { XfaMode } from "./xfa";

let pdfjsPromise: Promise<typeof import("pdfjs-dist")> | null = null;
export function getPdfjs() {
  if (!pdfjsPromise) {
    pdfjsPromise = import("pdfjs-dist").then((m) => {
      m.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();
      return m;
    });
  }
  return pdfjsPromise;
}
export type PdfSource = { data: Uint8Array } | { url: string; httpHeaders?: Record<string, string> };

/** Page sizes from backend metadata (unrotated width/height + /Rotate) so we don't have to load every page. */
export function sizesFromMetadata(pages: { width: number; height: number; rotation: number }[]): Size[] {
  return pages.map((p) => ((((p.rotation % 360) + 360) % 180) === 90 ? { width: p.height, height: p.width } : { width: p.width, height: p.height }));
}

export async function openPdf(src: PdfSource, knownSizes?: Size[]): Promise<{ doc: PDFDocumentProxy; sizes: Size[] }> {
  const pdfjs = await getPdfjs();
  // PDF.js only sends httpHeaders over http(s). The desktop app serves the UI from app://thynkpdf (stable origin), so
  // fetch the bytes here with the headers instead of letting PDF.js range-load (the engine is on this computer anyway).
  if ("url" in src && !/^https?:/i.test(new URL(src.url, globalThis.location?.href).protocol)) {
    const r = await fetch(src.url, { headers: src.httpHeaders });
    if (!r.ok) throw new Error(`Unexpected server response (${r.status}) while retrieving PDF`);
    src = { data: new Uint8Array(await r.arrayBuffer()) };
  }
  // enableXfa: dynamic XFA forms (LiveCycle/AEM) otherwise show only their "Please wait… open in Adobe Reader" placeholder page.
  const doc = await pdfjs.getDocument({ ...src, disableAutoFetch: true, isEvalSupported: false, enableXfa: true } as Parameters<typeof pdfjs.getDocument>[0]).promise;
  // Pure-XFA page count/sizes come from the XFA layout, not the placeholder page the backend metadata describes.
  if (doc.isPureXfa) knownSizes = undefined;
  if (knownSizes && knownSizes.length === doc.numPages) return { doc, sizes: knownSizes };
  const sizes: Size[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const vp = (await doc.getPage(i)).getViewport({ scale: 1 });
    sizes.push({ width: vp.width, height: vp.height });
  }
  return { doc, sizes };
}
export async function extractAllText(doc: PDFDocumentProxy): Promise<string[]> {
  const out: string[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const tc = await (await doc.getPage(i)).getTextContent();
    out.push(tc.items.map((it) => ("str" in it ? it.str : "")).join(""));
  }
  return out;
}

export async function detectXfa(doc: PDFDocumentProxy): Promise<XfaMode> {
  if (doc.isPureXfa) return "pure";
  const info = (await doc.getMetadata().catch(() => null))?.info as { IsXFAPresent?: boolean } | undefined;
  if (!info?.IsXFAPresent) return "none";
  let text = "";
  try { const tc = await (await doc.getPage(1)).getTextContent(); text = tc.items.map((it) => ("str" in it ? it.str : "")).join(" "); } catch { /* treat as hybrid */ }
  return classifyXfa({ isPureXfa: false, xfaPresent: true, firstPageText: text });
}
/** Bytes of the document with XFA field values the user typed (annotationStorage) written into the XFA datasets. */
export async function saveXfaDocument(doc: PDFDocumentProxy): Promise<Uint8Array> {
  return doc.saveDocument();
}
