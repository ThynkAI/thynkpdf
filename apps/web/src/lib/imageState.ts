"use client";
/** Placed-but-not-yet-saved images (move/resize/rotate/delete, undoable) and page export. */
import { create } from "zustand";
import { useViewerStore } from "@thynkpdf/pdf-viewer";
import { record } from "./history";
import { useSession } from "./session";
import { type Placed, type Embeddable, placementToPdf, insertImages, zipStore } from "./images";

export interface ImageState { items: Placed[]; selected: string | null; set(p: Partial<ImageState>): void }
export const useImages = create<ImageState>((set) => ({ items: [], selected: null, set: (p) => set(p) }));
let seq = 0;
const nid = () => `im${Date.now().toString(36)}${(seq++).toString(36)}`;
type Geo = Pick<Placed, "left" | "top" | "width" | "height" | "rotation">;

const patch = (id: string, g: Partial<Geo>) => useImages.getState().set({ items: useImages.getState().items.map((x) => (x.id === id ? { ...x, ...g } : x)) });

/** Place an image centred on a page (max half the page width), selected and ready to move. */
export async function placeImage(img: Embeddable, page: number) {
  const { getGeom } = await import("./pageGeom"); const g = await getGeom(page); if (!g) return;
  const rot = ((g.rotation % 360) + 360) % 360; const pw = rot % 180 ? g.height : g.width, ph = rot % 180 ? g.width : g.height;
  let w = Math.min(pw * 0.5, (img.width * 72) / 96), h = (w * img.height) / img.width;
  if (h > ph * 0.6) { h = ph * 0.6; w = (h * img.width) / img.height; }
  const url = URL.createObjectURL(new Blob([img.bytes as BlobPart], { type: img.mime }));
  const it: Placed = { id: nid(), page, left: (pw - w) / 2, top: (ph - h) / 2, width: w, height: h, rotation: 0, img: { ...img, url } };
  const s = useImages.getState(); s.set({ items: [...s.items, it], selected: it.id });
  record({ label: "Add image",
    undo: async () => { const t = useImages.getState(); t.set({ items: t.items.filter((x) => x.id !== it.id), selected: null }); },
    redo: async () => { const t = useImages.getState(); t.set({ items: [...t.items, it], selected: it.id }); } });
}
/** Record a finished move/resize/rotate (before → after) as one undo step. */
export function commitTransform(id: string, before: Geo, after: Geo, label = "Move image") {
  if (JSON.stringify(before) === JSON.stringify(after)) return;
  record({ label, undo: async () => patch(id, before), redo: async () => patch(id, after) });
}
export function transform(id: string, g: Partial<Geo>, label: string) {
  const it = useImages.getState().items.find((x) => x.id === id); if (!it) return;
  const before = { left: it.left, top: it.top, width: it.width, height: it.height, rotation: it.rotation };
  patch(id, g); commitTransform(id, before, { ...before, ...g }, label);
}
export const setGeo = patch;
export function removeImage(id: string) {
  const s = useImages.getState(); const it = s.items.find((x) => x.id === id); if (!it) return false;
  const idx = s.items.indexOf(it);
  s.set({ items: s.items.filter((x) => x.id !== id), selected: null });
  record({ label: "Delete image",
    undo: async () => { const t = useImages.getState(); const a = [...t.items]; a.splice(idx, 0, it); t.set({ items: a }); },
    redo: async () => { const t = useImages.getState(); t.set({ items: t.items.filter((x) => x.id !== id) }); } });
  return true;
}

/** Save placed images into the PDF: server documents get a new version, local ones are edited in the browser. */
export async function applyImages(): Promise<"server" | "local" | false> {
  const items = useImages.getState().items; if (!items.length) return false;
  const s = useSession.getState();
  try {
    const { currentBytes, saveModifiedCopy } = await import("./copies"); const { getGeom } = await import("./pageGeom");
    const bytes = await currentBytes();
    const draw = [];
    for (const it of items) { const g = await getGeom(it.page); if (!g) continue; draw.push({ page: it.page, img: it.img, at: placementToPdf(it, g) }); }
    const out = await insertImages(bytes, draw);
    const r = await saveModifiedCopy(out, "images");
    if (!r) return false;
    items.forEach((i) => URL.revokeObjectURL(i.img.url));
    useImages.getState().set({ items: [], selected: null });
    s.set({ notice: `${items.length} image${items.length === 1 ? "" : "s"} saved into the PDF${r.kind === "server" ? " as a new version" : " (local copy — use Download to keep it)"}.` });
    return r.kind;
  } catch (e) { s.set({ error: `Saving images failed: ${(e as Error).message}` }); return false; }
}

export function download(name: string, data: Blob) {
  const a = document.createElement("a"); a.href = URL.createObjectURL(data); a.download = name; document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 4000);
}

/** Render pages with PDF.js to PNG/JPEG. One page downloads the image; several pages download one .zip. */
export async function exportPages(pages: number[], format: "png" | "jpeg", dpi: number, onProgress?: (n: number) => void) {
  const v = useViewerStore.getState(); const doc = v.doc; if (!doc || !pages.length) return;
  const base = (v.fileName ?? "document.pdf").replace(/ \(v\d+\)$/, "").replace(/\.pdf$/i, "");
  const ext = format === "png" ? "png" : "jpg"; const files: { name: string; data: Uint8Array }[] = [];
  for (const [i, n] of pages.entries()) {
    const page = await doc.getPage(n + 1);
    let vp = page.getViewport({ scale: dpi / 72 });
    const k = vp.width * vp.height > 40e6 ? Math.sqrt(40e6 / (vp.width * vp.height)) : 1; // cap at 40 MP per page
    if (k < 1) vp = page.getViewport({ scale: (dpi / 72) * k });
    const c = document.createElement("canvas"); c.width = Math.floor(vp.width); c.height = Math.floor(vp.height);
    const ctx = c.getContext("2d")!; ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, c.width, c.height);
    await page.render({ canvasContext: ctx, viewport: vp }).promise;
    const blob: Blob = await new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error("encode failed"))), `image/${format}`, 0.92));
    files.push({ name: `${base}-page-${n + 1}.${ext}`, data: new Uint8Array(await blob.arrayBuffer()) });
    onProgress?.(i + 1);
  }
  if (files.length === 1) download(files[0].name, new Blob([files[0].data as BlobPart], { type: `image/${format}` }));
  else download(`${base}-pages-${ext}.zip`, new Blob([zipStore(files) as BlobPart], { type: "application/zip" }));
  return files.length;
}

/** Open image file(s) directly: converted to a PDF in the browser (one page per image), then opened like any PDF. */
export async function openImagesAsPdf(files: File[], size: import("./images").PageSize = "fit") {
  const s = useSession.getState();
  s.set({ busy: "Converting image…", error: null });
  try {
    const { toEmbeddable, imagesToPdf } = await import("./images");
    const imgs = []; for (const f of files) imgs.push(await toEmbeddable(f));
    const pdf = await imagesToPdf(imgs, size);
    const name = files[0].name.replace(/\.[^.]+$/, "") + ".pdf";
    s.set({ busy: null });
    const { openFile } = await import("./documents");
    await openFile(new File([pdf as BlobPart], name, { type: "application/pdf" }));
    return true;
  } catch (e) { s.set({ error: `Could not open image: ${(e as Error).message}` }); return false; }
  finally { if (useSession.getState().busy === "Converting image…") s.set({ busy: null }); }
}
