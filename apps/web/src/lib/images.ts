/**
 * Image support (pdf-lib, MIT): images → PDF, images placed onto pages, and small helpers to read image headers
 * and write a store-only ZIP for "export all pages". PNG/JPEG are embedded as-is (JPEG is never re-compressed);
 * WebP/GIF/BMP/AVIF are decoded by the browser and embedded as PNG. Pure functions here are unit-tested.
 */
import { degrees, PDFDocument } from "pdf-lib";
import { displayToPdf, type PageGeom } from "./geometry";

export type ImageMime = "image/png" | "image/jpeg";
export interface Embeddable { bytes: Uint8Array; mime: ImageMime; width: number; height: number; name: string }

export const IMAGE_EXTS = ["png", "jpg", "jpeg", "webp", "gif", "bmp", "avif"];
export const IMAGE_ACCEPT = "image/png,image/jpeg,image/webp,image/gif,image/bmp,image/avif,.png,.jpg,.jpeg,.webp,.gif,.bmp,.avif";
export const OPEN_ACCEPT = `application/pdf,.pdf,${IMAGE_ACCEPT}`;
export const isPdfFile = (f: { name: string; type?: string }) => f.type === "application/pdf" || /\.pdf$/i.test(f.name);
export const isImageFile = (f: { name: string; type?: string }) => (!!f.type && f.type.startsWith("image/") && f.type !== "image/svg+xml") || new RegExp(`\\.(${IMAGE_EXTS.join("|")})$`, "i").test(f.name);

/** Magic bytes. */
export function sniff(b: Uint8Array): ImageMime | null {
  if (b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "image/png";
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  return null;
}

/** Pixel size from the PNG IHDR or JPEG SOFn header (no decoding). */
export function imageSize(b: Uint8Array, mime: ImageMime): { width: number; height: number } | null {
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  if (mime === "image/png") return b.length >= 24 ? { width: dv.getUint32(16), height: dv.getUint32(20) } : null;
  let i = 2;
  while (i + 9 < b.length) {
    if (b[i] !== 0xff) { i++; continue; }
    const m = b[i + 1];
    if (m === 0xd8 || m === 0x01 || (m >= 0xd0 && m <= 0xd7)) { i += 2; continue; }
    const len = dv.getUint16(i + 2);
    if ((m >= 0xc0 && m <= 0xcf) && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return { height: dv.getUint16(i + 5), width: dv.getUint16(i + 7) };
    i += 2 + len;
  }
  return null;
}

/** EXIF orientation of a JPEG (1 = upright). Phone photos are often stored sideways with orientation 6/8. */
export function jpegOrientation(b: Uint8Array): number {
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  let i = 2;
  while (i + 4 < b.length && b[i] === 0xff) {
    const m = b[i + 1], len = dv.getUint16(i + 2);
    if (m === 0xe1 && b[i + 4] === 0x45 && b[i + 5] === 0x78 && b[i + 6] === 0x69 && b[i + 7] === 0x66) {
      const t = i + 10; const le = dv.getUint16(t) === 0x4949;
      const ifd = t + dv.getUint32(t + 4, le); const n = dv.getUint16(ifd, le);
      for (let k = 0; k < n; k++) { const e = ifd + 2 + k * 12; if (e + 10 > b.length) break; if (dv.getUint16(e, le) === 0x0112) return dv.getUint16(e + 8, le); }
      return 1;
    }
    if (m === 0xda) break;
    i += 2 + len;
  }
  return 1;
}

/** Read a picked/dropped image. PNG and upright JPEG pass through; anything else is decoded by the browser to PNG. */
export async function toEmbeddable(file: Blob & { name?: string }): Promise<Embeddable> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const name = file.name ?? "image";
  const mime = sniff(bytes);
  if (mime) {
    const sz = imageSize(bytes, mime);
    if (sz && sz.width > 0 && sz.height > 0 && (mime === "image/png" || jpegOrientation(bytes) === 1)) return { bytes, mime, ...sz, name };
  }
  if (typeof createImageBitmap !== "function") throw new Error(`${name}: this image type can't be read here`);
  let bmp: ImageBitmap;
  try { bmp = await createImageBitmap(file, { imageOrientation: "from-image" }); } catch { throw new Error(`${name} is not a supported image (PNG, JPEG, WebP, GIF, BMP, AVIF)`); }
  const c = document.createElement("canvas"); c.width = bmp.width; c.height = bmp.height;
  c.getContext("2d")!.drawImage(bmp, 0, 0); bmp.close?.();
  const jpeg = mime === "image/jpeg";
  const blob: Blob = await new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error("encode failed"))), jpeg ? "image/jpeg" : "image/png", 0.92));
  return { bytes: new Uint8Array(await blob.arrayBuffer()), mime: jpeg ? "image/jpeg" : "image/png", width: c.width, height: c.height, name };
}

export type PageSize = "fit" | "a4" | "letter";
const SIZES: Record<Exclude<PageSize, "fit">, [number, number]> = { a4: [595.28, 841.89], letter: [612, 792] };

/** Layout of one image on its page (pure; unit-tested). fit: page = image at 96 dpi. A4/Letter: oriented like the image, centred within the margin. */
export function layoutImage(w: number, h: number, size: PageSize, margin = 36) {
  if (size === "fit") { const pw = (w * 72) / 96, ph = (h * 72) / 96; return { pageW: pw, pageH: ph, x: 0, y: 0, w: pw, h: ph }; }
  let [pw, ph] = SIZES[size]; if (w > h) [pw, ph] = [ph, pw];
  const k = Math.min((pw - 2 * margin) / w, (ph - 2 * margin) / h);
  const dw = w * k, dh = h * k;
  return { pageW: pw, pageH: ph, x: (pw - dw) / 2, y: (ph - dh) / 2, w: dw, h: dh };
}

/** Create a PDF with one page per image, in the given order. */
export async function imagesToPdf(imgs: Embeddable[], size: PageSize = "fit", margin = 36): Promise<Uint8Array> {
  if (!imgs.length) throw new Error("Add at least one image.");
  const pdf = await PDFDocument.create();
  pdf.setProducer("THYNKPDF"); pdf.setCreator("THYNKPDF");
  for (const im of imgs) {
    const e = im.mime === "image/png" ? await pdf.embedPng(im.bytes) : await pdf.embedJpg(im.bytes);
    const L = layoutImage(im.width, im.height, size, margin);
    const pg = pdf.addPage([L.pageW, L.pageH]);
    pg.drawImage(e, { x: L.x, y: L.y, width: L.w, height: L.h });
  }
  return pdf.save();
}

/** A placed image in DISPLAY points (scale 1, top-left origin of the page as shown), rotation = clockwise degrees as seen. */
export interface Placed { id: string; page: number; left: number; top: number; width: number; height: number; rotation: number; img: Embeddable & { url: string } }

/** Display placement → pdf-lib drawImage args (bottom-left corner + CCW rotation), keeping the visual centre. Pure; unit-tested. */
export function placementToPdf(p: { left: number; top: number; width: number; height: number; rotation: number }, g: PageGeom) {
  const [cx, cy] = displayToPdf(p.left + p.width / 2, p.top + p.height / 2, g, 1);
  const phi = ((((g.rotation - p.rotation) % 360) + 360) % 360);
  const r = (phi * Math.PI) / 180, c = Math.cos(r), s = Math.sin(r);
  const w = p.width, h = p.height;
  return { x: cx - (w / 2) * c + (h / 2) * s, y: cy - (w / 2) * s - (h / 2) * c, width: w, height: h, rotate: phi };
}

/** Draw placed images into the PDF (real page content, saved in the file). */
export async function insertImages(bytes: Uint8Array, items: { page: number; img: Embeddable; at: ReturnType<typeof placementToPdf> }[]): Promise<Uint8Array> {
  const pdf = await PDFDocument.load(bytes);
  const cache = new Map<Uint8Array, Awaited<ReturnType<PDFDocument["embedPng"]>>>();
  for (const it of items) {
    let e = cache.get(it.img.bytes);
    if (!e) { e = it.img.mime === "image/png" ? await pdf.embedPng(it.img.bytes) : await pdf.embedJpg(it.img.bytes); cache.set(it.img.bytes, e); }
    const { rotate, ...r } = it.at;
    pdf.getPage(it.page).drawImage(e, { ...r, rotate: degrees(rotate) });
  }
  const { savePdf } = await import("./pdfWrite");
  return savePdf(pdf);
}

// ---- store-only ZIP (for "export all pages"); CRC-32 per PKWARE APPNOTE ----
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
export function crc32(b: Uint8Array) { let c = 0xffffffff; for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
export function zipStore(files: { name: string; data: Uint8Array }[]): Uint8Array {
  const enc = new TextEncoder(); const parts: Uint8Array[] = []; const central: Uint8Array[] = []; let off = 0;
  for (const f of files) {
    const nm = enc.encode(f.name), crc = crc32(f.data), sz = f.data.length;
    const h = new Uint8Array(30 + nm.length); const d = new DataView(h.buffer);
    d.setUint32(0, 0x04034b50, true); d.setUint16(4, 20, true); d.setUint16(6, 0x0800, true); d.setUint16(8, 0, true);
    d.setUint32(14, crc, true); d.setUint32(18, sz, true); d.setUint32(22, sz, true); d.setUint16(26, nm.length, true); h.set(nm, 30);
    const c = new Uint8Array(46 + nm.length); const e = new DataView(c.buffer);
    e.setUint32(0, 0x02014b50, true); e.setUint16(4, 20, true); e.setUint16(6, 20, true); e.setUint16(8, 0x0800, true);
    e.setUint32(16, crc, true); e.setUint32(20, sz, true); e.setUint32(24, sz, true); e.setUint16(28, nm.length, true); e.setUint32(42, off, true); c.set(nm, 46);
    parts.push(h, f.data); central.push(c); off += h.length + sz;
  }
  const cd = central.reduce((n, c) => n + c.length, 0);
  const end = new Uint8Array(22); const z = new DataView(end.buffer);
  z.setUint32(0, 0x06054b50, true); z.setUint16(8, files.length, true); z.setUint16(10, files.length, true); z.setUint32(12, cd, true); z.setUint32(16, off, true);
  const out = new Uint8Array(off + cd + 22); let p = 0;
  for (const x of [...parts, ...central, end]) { out.set(x, p); p += x.length; }
  return out;
}
