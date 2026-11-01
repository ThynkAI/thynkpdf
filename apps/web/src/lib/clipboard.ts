/**
 * In-app clipboard for annotations and pages. Annotations are copied as their real PDF dictionaries (pdf-lib PDFObjectCopier),
 * so every type (ink, shapes, stamps, notes, markup) pastes with its appearance stream intact.
 */
import { PDFDocument, PDFName, PDFArray, PDFDict, PDFNumber, PDFString, PDFHexString, PDFObjectCopier, PDFRef } from "pdf-lib";

export type Clip =
  | { kind: "annots"; source: Uint8Array; ids: string[]; fromPage: number }
  | { kind: "pages"; pdf: Uint8Array; count: number };

let clip: Clip | null = null;
let pasteCount = 0;
export const getClip = () => clip;
export function setClip(c: Clip | null) { clip = c; pasteCount = 0; }
/** Each successive paste of the same clip is offset a little further so copies do not stack invisibly. */
export function nextPasteOffset(samePage: boolean) { pasteCount += 1; return samePage ? 12 * pasteCount : 12 * (pasteCount - 1); }

const save = (d: PDFDocument) => d.save({ useObjectStreams: false });
const text = (d: PDFDict, k: string) => { const v = d.lookup(PDFName.of(k)); return v instanceof PDFString || v instanceof PDFHexString ? v.decodeText() : undefined; };
const newId = () => (globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`);

function annotsById(doc: PDFDocument, ids: string[]) {
  const want = new Set(ids); const out: PDFDict[] = [];
  doc.getPages().forEach((pg) => {
    const a = pg.node.lookupMaybe(PDFName.of("Annots"), PDFArray); if (!a) return;
    for (let i = 0; i < a.size(); i++) {
      const d = a.lookup(i); const r = a.get(i);
      if (!(d instanceof PDFDict)) continue;
      const id = text(d, "NM") ?? (r instanceof PDFRef ? `ref-${r.objectNumber}-${r.generationNumber}` : "");
      if (want.has(id)) out.push(d);
    }
  });
  return out;
}

/** Shift every coordinate array of an annotation by (dx, dy) in PDF user space. */
function shift(doc: PDFDocument, d: PDFDict, dx: number, dy: number) {
  const move = (key: string) => {
    const a = d.lookupMaybe(PDFName.of(key), PDFArray); if (!a) return;
    const nums = a.asArray().map((x, i) => (x instanceof PDFNumber ? x.asNumber() + (i % 2 ? dy : dx) : 0));
    d.set(PDFName.of(key), doc.context.obj(nums));
  };
  ["Rect", "QuadPoints", "L", "CL", "Vertices"].forEach(move);
  const ink = d.lookupMaybe(PDFName.of("InkList"), PDFArray);
  if (ink) d.set(PDFName.of("InkList"), doc.context.obj(ink.asArray().map((p) => {
    const arr = doc.context.lookup(p) as PDFArray;
    return arr.asArray().map((x, i) => (x instanceof PDFNumber ? x.asNumber() + (i % 2 ? dy : dx) : 0));
  })));
}

/** Paste annotations `ids` from `source` onto 0-based `page` of `target`, offset by (dx, -dy). Returns new bytes and the new ids. */
export async function pasteAnnotations(target: Uint8Array, source: Uint8Array, ids: string[], page: number, offset: number) {
  const dst = await PDFDocument.load(target, { updateMetadata: false });
  const src = await PDFDocument.load(source, { updateMetadata: false });
  const copier = PDFObjectCopier.for(src.context, dst.context);
  const pg = dst.getPage(page);
  let annots = pg.node.lookupMaybe(PDFName.of("Annots"), PDFArray);
  if (!annots) { annots = dst.context.obj([]); pg.node.set(PDFName.of("Annots"), annots); }
  const newIds: string[] = [];
  for (const d of annotsById(src, ids)) {
    const c = d.clone(src.context);
    // Drop links back into the source document (page, popup, reply chains); they are re-created for the copy.
    ["P", "Popup", "IRT", "RT", "Parent"].forEach((k) => c.delete(PDFName.of(k)));
    const copy = copier.copy(c);
    const id = newId(); newIds.push(id);
    copy.set(PDFName.of("NM"), PDFHexString.fromText(id));
    copy.set(PDFName.of("P"), pg.ref);
    shift(dst, copy, offset, -offset);
    annots.push(dst.context.register(copy));
  }
  return { bytes: await save(dst), ids: newIds };
}
