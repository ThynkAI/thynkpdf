"use client";
import { useViewerStore } from "@thynkpdf/pdf-viewer";
import { useSession } from "./session";
import { useAnnot } from "./annotState";
import { currentBytes } from "./copies";
import { getClip, setClip } from "./clipboard";
import { extractLocal, insertPdfLocal } from "./localPages";
import { deletePages, localBytesOp, runVersionedOp, http } from "./documents";
import { copySelectedAnnotations, cutSelectedAnnotations, pasteAnnotationsHere, eraseAnnotations } from "./annotActions";

const notice = (n: string) => useSession.getState().set({ notice: n, error: null });

/** Copy 1-based pages into the page clipboard. */
export async function copyPages(pages: number[]) {
  const pdf = await extractLocal(await currentBytes(), pages);
  setClip({ kind: "pages", pdf, count: pages.length });
  notice(`Copied ${pages.length === 1 ? `page ${pages[0]}` : `${pages.length} pages`}. Paste with Ctrl+V.`);
}
export async function cutPages(pages: number[]) {
  if (pages.length >= useViewerStore.getState().pageSizes.length) { useSession.getState().set({ error: "Cannot cut every page of the document." }); return; }
  await copyPages(pages);
  await deletePages(pages);
}
/** Paste clipboard pages after 1-based page `after`. Server documents get a new version; local ones are edited in the browser. */
export async function pastePages(after: number) {
  const c = getClip(); if (!c || c.kind !== "pages") return false;
  const s = useSession.getState();
  let ok: boolean;
  if (s.ref && s.api.kind === "http") {
    const bytes = await insertPdfLocal(await currentBytes(), c.pdf, after);
    ok = !!(await runVersionedOp("Paste pages", (r) => http().uploadVersion(r, bytes, useViewerStore.getState().fileName ?? "document.pdf")));
  } else ok = await localBytesOp("Paste pages", (b) => insertPdfLocal(b, c.pdf, after));
  if (ok) useViewerStore.getState().goToPage(after);
  return ok;
}

/** Ctrl+C: native copy for selected PDF text, otherwise annotations, otherwise the current page. Returns true when handled here. */
export async function copyAction(): Promise<boolean> {
  if (hasTextSelection()) return false; // let the browser copy the selected text natively
  if (useAnnot.getState().selected.length) { const n = await copySelectedAnnotations(); notice(`Copied ${n} annotation${n > 1 ? "s" : ""}.`); return true; }
  const v = useViewerStore.getState(); if (!v.pageSizes.length) return false;
  await copyPages([v.currentPage + 1]); return true;
}
export async function cutAction(): Promise<boolean> {
  if (hasTextSelection()) return false;
  if (useAnnot.getState().selected.length) { const n = await cutSelectedAnnotations(); notice(`Cut ${n} annotation${n > 1 ? "s" : ""}.`); return true; }
  const v = useViewerStore.getState(); if (!v.pageSizes.length) return false;
  await cutPages([v.currentPage + 1]); return true;
}
export async function pasteAction(): Promise<boolean> {
  const c = getClip(); if (!c) return false;
  if (c.kind === "annots") return pasteAnnotationsHere();
  return pastePages(useViewerStore.getState().currentPage + 1);
}
export async function deleteSelection(): Promise<boolean> {
  const ids = useAnnot.getState().selected; if (!ids.length) return false;
  return eraseAnnotations(ids);
}

export function hasTextSelection() {
  const sel = typeof window !== "undefined" ? window.getSelection() : null;
  return !!sel && !sel.isCollapsed && sel.toString().trim().length > 0;
}
/** Ctrl+A: select all text of the current page's text layer (the PDF has no single text flow across pages). */
export function selectAllPageText(): boolean {
  const n = useViewerStore.getState().currentPage + 1;
  const layer = document.querySelector(`.tp-viewer .tp-page[data-page="${n}"] .textLayer`) ?? document.querySelector(`.tp-page[data-page="${n}"] .textLayer`);
  if (!layer || !layer.textContent?.trim()) return false;
  const r = document.createRange(); r.selectNodeContents(layer);
  const sel = window.getSelection(); sel?.removeAllRanges(); sel?.addRange(r);
  useAnnot.getState().set({ selected: [] });
  return true;
}
