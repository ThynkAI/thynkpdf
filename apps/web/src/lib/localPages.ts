/** Client-side page operations with pdf-lib (MIT). Used when there is no THYNKPDF server document (offline / local files). Pages are 1-based. */
import { PDFDocument, degrees } from "pdf-lib";

const load = (b: Uint8Array) => PDFDocument.load(b, { ignoreEncryption: true, updateMetadata: false });
const save = (d: PDFDocument) => d.save({ useObjectStreams: false });

export async function rotateLocal(bytes: Uint8Array, pages: number[], angle: number) {
  const d = await load(bytes);
  for (const n of pages) { const p = d.getPage(n - 1); p.setRotation(degrees((((p.getRotation().angle + angle) % 360) + 360) % 360)); }
  return save(d);
}
/** order: new sequence of 1-based source page numbers (a permutation, or any subset/duplicates). */
export async function reorderLocal(bytes: Uint8Array, order: number[]) {
  const src = await load(bytes);
  const out = await load(bytes);
  const n = out.getPageCount();
  const copied = await out.copyPages(src, order.map((p) => p - 1));
  copied.forEach((p) => out.addPage(p));
  for (let i = 0; i < n; i++) out.removePage(0);
  return save(out);
}
export async function deleteLocal(bytes: Uint8Array, pages: number[]) {
  const d = await load(bytes);
  if (new Set(pages).size >= d.getPageCount()) throw new Error("Cannot delete every page.");
  [...new Set(pages)].sort((a, b) => b - a).forEach((p) => d.removePage(p - 1));
  return save(d);
}
export async function duplicateLocal(bytes: Uint8Array, pages: number[]) {
  const d = await load(bytes);
  const order: number[] = [];
  for (let i = 1; i <= d.getPageCount(); i++) { order.push(i); if (pages.includes(i)) order.push(i); }
  return reorderLocal(bytes, order);
}
/** Insert `count` blank pages after 1-based page `after` (0 = at the start), sized like the neighbouring page. */
export async function insertBlankLocal(bytes: Uint8Array, after: number, count = 1) {
  const d = await load(bytes);
  const ref = d.getPage(Math.max(0, Math.min(after, d.getPageCount()) - 1));
  const { width, height } = ref.getSize();
  for (let i = 0; i < count; i++) d.insertPage(after + i, [width, height]);
  return save(d);
}
/** Copy pages into a standalone PDF (the page clipboard). */
export async function extractLocal(bytes: Uint8Array, pages: number[]) {
  const src = await load(bytes); const out = await PDFDocument.create();
  (await out.copyPages(src, pages.map((p) => p - 1))).forEach((p) => out.addPage(p));
  return save(out);
}
/** Insert every page of `clip` after 1-based page `after` (0 = at the start). */
export async function insertPdfLocal(bytes: Uint8Array, clip: Uint8Array, after: number) {
  const d = await load(bytes); const c = await load(clip);
  (await d.copyPages(c, c.getPageIndices())).forEach((p, i) => d.insertPage(after + i, p));
  return save(d);
}
export async function pageCount(bytes: Uint8Array) { return (await load(bytes)).getPageCount(); }
