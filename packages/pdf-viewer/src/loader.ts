"use client";
import type { PDFDocumentProxy } from "pdfjs-dist";
import type { Size } from "./zoom";

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

export async function openPdf(src: PdfSource): Promise<{ doc: PDFDocumentProxy; sizes: Size[] }> {
  const pdfjs = await getPdfjs();
  const doc = await pdfjs.getDocument({ ...src, disableAutoFetch: true, isEvalSupported: false } as Parameters<typeof pdfjs.getDocument>[0]).promise;
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
