import { deflateSync } from "node:zlib";
import { PDFDocument, PDFName, PDFDict, PDFRawStream, PDFArray, decodePDFRawStream } from "pdf-lib";
import { sniff, imageSize, jpegOrientation, imagesToPdf, layoutImage, placementToPdf, insertImages, zipStore, crc32, isImageFile, isPdfFile, type Embeddable } from "@/lib/images";
import { uprightImagePlacement } from "@/lib/geometry";

function png(w: number, h: number): Uint8Array {
  const chunk = (type: string, data: Uint8Array) => {
    const t = new TextEncoder().encode(type); const out = new Uint8Array(12 + data.length); const dv = new DataView(out.buffer);
    dv.setUint32(0, data.length); out.set(t, 4); out.set(data, 8); dv.setUint32(8 + data.length, crc32(new Uint8Array([...t, ...data]))); return out;
  };
  const ihdr = new Uint8Array(13); const d = new DataView(ihdr.buffer); d.setUint32(0, w); d.setUint32(4, h); ihdr[8] = 8; ihdr[9] = 2;
  const raw = new Uint8Array(h * (1 + w * 3)); for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) raw.set([x * 20, y * 20, 128], y * (1 + w * 3) + 1 + x * 3);
  const parts = [new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", new Uint8Array(deflateSync(raw))), chunk("IEND", new Uint8Array())];
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0)); let o = 0; for (const p of parts) { out.set(p, o); o += p.length; } return out;
}
/** Header-only baseline JPEG (SOI, optional EXIF APP1, SOF0, EOI): enough for size/orientation parsing and pdf-lib embedding. */
function jpeg(w: number, h: number, orientation?: number): Uint8Array {
  const b: number[] = [0xff, 0xd8];
  if (orientation) {
    const tiff = [0x4d, 0x4d, 0x00, 0x2a, 0, 0, 0, 8, 0, 1, 0x01, 0x12, 0, 3, 0, 0, 0, 1, 0, orientation, 0, 0, 0, 0, 0, 0];
    const payload = [0x45, 0x78, 0x69, 0x66, 0, 0, ...tiff];
    b.push(0xff, 0xe1, ((payload.length + 2) >> 8) & 0xff, (payload.length + 2) & 0xff, ...payload);
  }
  b.push(0xff, 0xc0, 0, 17, 8, h >> 8, h & 0xff, w >> 8, w & 0xff, 3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1, 0xff, 0xd9);
  return new Uint8Array(b);
}
const emb = (bytes: Uint8Array, mime: "image/png" | "image/jpeg", w: number, h: number, name = "a"): Embeddable => ({ bytes, mime, width: w, height: h, name });

describe("image headers", () => {
  it("sniffs and sizes PNG and JPEG without decoding", () => {
    const p = png(30, 20), j = jpeg(640, 480);
    expect(sniff(p)).toBe("image/png"); expect(sniff(j)).toBe("image/jpeg"); expect(sniff(new Uint8Array([1, 2, 3, 4]))).toBeNull();
    expect(imageSize(p, "image/png")).toEqual({ width: 30, height: 20 });
    expect(imageSize(j, "image/jpeg")).toEqual({ width: 640, height: 480 });
  });
  it("reads EXIF orientation (sideways phone photos are re-encoded upright)", () => {
    expect(jpegOrientation(jpeg(10, 10))).toBe(1);
    expect(jpegOrientation(jpeg(10, 10, 6))).toBe(6);
    expect(imageSize(jpeg(320, 200, 6), "image/jpeg")).toEqual({ width: 320, height: 200 });
  });
  it("recognises openable files", () => {
    expect(isImageFile({ name: "scan.JPG" })).toBe(true); expect(isImageFile({ name: "x.webp", type: "image/webp" })).toBe(true);
    expect(isImageFile({ name: "x.svg", type: "image/svg+xml" })).toBe(false); expect(isPdfFile({ name: "a.PDF" })).toBe(true);
  });
});

describe("images → PDF", () => {
  it("one page per image, in order, page sized to the image (96 dpi) or fitted to A4/Letter", async () => {
    const bytes = await imagesToPdf([emb(png(96, 48), "image/png", 96, 48), emb(jpeg(400, 800), "image/jpeg", 400, 800)], "fit");
    const pdf = await PDFDocument.load(bytes);
    expect(pdf.getPageCount()).toBe(2);
    expect(pdf.getPage(0).getSize()).toEqual({ width: 72, height: 36 });
    expect(pdf.getPage(1).getSize()).toEqual({ width: 300, height: 600 });
    const subtypes = pdf.context.enumerateIndirectObjects().map(([, o]) => (o instanceof PDFRawStream ? o.dict.get(PDFName.of("Subtype"))?.toString() : null)).filter(Boolean);
    expect(subtypes.filter((s) => s === "/Image").length).toBeGreaterThanOrEqual(2);
    const a4 = await PDFDocument.load(await imagesToPdf([emb(png(200, 100), "image/png", 200, 100)], "a4"));
    const sz = a4.getPage(0).getSize(); expect(Math.round(sz.width)).toBe(842); expect(Math.round(sz.height)).toBe(595); // landscape image → landscape page
  });
  it("layout keeps aspect and centres within the margin", () => {
    const L = layoutImage(1000, 500, "letter", 36);
    expect(L.pageW).toBe(792); expect(L.w / L.h).toBeCloseTo(2); expect(L.x).toBeCloseTo((792 - L.w) / 2); expect(L.w).toBeCloseTo(720);
  });
  it("rejects an empty list", async () => { await expect(imagesToPdf([])).rejects.toThrow(/at least one/); });
});

describe("place image on a page", () => {
  const g = { width: 612, height: 792, rotation: 0 };
  it("no rotation: bottom-left corner from the display box", () => {
    expect(placementToPdf({ left: 100, top: 100, width: 200, height: 100, rotation: 0 }, g)).toEqual({ x: 100, y: 592, width: 200, height: 100, rotate: 0 });
  });
  it("matches the signature placement on rotated pages", () => {
    const g90 = { width: 612, height: 792, rotation: 90 };
    const a = placementToPdf({ left: 10, top: 10, width: 100, height: 50, rotation: 0 }, g90);
    const b = uprightImagePlacement(10, 10, 100, 50, g90, 1);
    expect(a.x).toBeCloseTo(b.x); expect(a.y).toBeCloseTo(b.y); expect(a.rotate).toBe(b.rotate);
  });
  it("user rotation keeps the visual centre (clockwise on screen = negative PDF angle)", () => {
    const r = placementToPdf({ left: 100, top: 100, width: 200, height: 100, rotation: 90 }, g);
    expect(r.rotate).toBe(270);
    const t = (r.rotate * Math.PI) / 180; // centre = corner + R·(w/2, h/2)
    expect(r.x + Math.cos(t) * 100 - Math.sin(t) * 50).toBeCloseTo(200);
    expect(r.y + Math.sin(t) * 100 + Math.cos(t) * 50).toBeCloseTo(792 - 150);
  });
  it("draws the image into page content (saved in the file)", async () => {
    const src = await PDFDocument.create(); src.addPage([612, 792]); const bytes = await src.save();
    const out = await insertImages(bytes, [{ page: 0, img: emb(png(20, 10), "image/png", 20, 10), at: placementToPdf({ left: 50, top: 50, width: 100, height: 50, rotation: 30 }, g) }]);
    const pdf = await PDFDocument.load(out);
    const xo = pdf.getPage(0).node.Resources()!.lookup(PDFName.of("XObject"), PDFDict);
    expect(xo.keys().length).toBe(1);
    const contents = pdf.getPage(0).node.Contents()!;
    const streams = contents instanceof PDFArray ? contents.asArray().map((r) => pdf.context.lookup(r) as PDFRawStream) : [contents as unknown as PDFRawStream];
    const ops = streams.map((st) => new TextDecoder().decode(decodePDFRawStream(st).decode())).join("\n");
    expect(ops).toMatch(/\/Image-?\w*\s+Do/);
    // 30° clockwise on screen → -30° in PDF space, about the box centre (100, 717)
    expect(ops).toMatch(/0\.866\d* -0\.5\d* 0\.5\d* 0\.866\d* 0 0 cm\s+100 0 0 50 0 0 cm/);
    const [, tx, ty] = ops.match(/1 0 0 1 ([\d.]+) ([\d.]+) cm/)!.map(Number);
    expect(tx + 0.866 * 50 + 0.5 * 25).toBeCloseTo(100, 1); expect(ty - 0.5 * 50 + 0.866 * 25).toBeCloseTo(717, 1);
  });
});

describe("zip export", () => {
  it("writes a valid store-only archive", () => {
    expect(crc32(new TextEncoder().encode("hello"))).toBe(0x3610a686);
    const z = zipStore([{ name: "p-1.png", data: new Uint8Array([1, 2, 3]) }, { name: "p-2.png", data: new Uint8Array([4]) }]);
    const dv = new DataView(z.buffer);
    expect(dv.getUint32(0, true)).toBe(0x04034b50);
    const end = z.length - 22; expect(dv.getUint32(end, true)).toBe(0x06054b50); expect(dv.getUint16(end + 10, true)).toBe(2);
    const cdOff = dv.getUint32(end + 16, true); expect(dv.getUint32(cdOff, true)).toBe(0x02014b50);
    expect(new TextDecoder().decode(z.slice(30, 37))).toBe("p-1.png");
  });
});
