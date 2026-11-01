import { PDFDocument } from "pdf-lib";
import { addAnnotations, readAnnotations } from "@/lib/annotWrite";
import { pasteAnnotations, setClip, getClip, nextPasteOffset } from "@/lib/clipboard";
import { rotateLocal, reorderLocal, deleteLocal, duplicateLocal, insertBlankLocal, extractLocal, insertPdfLocal } from "@/lib/localPages";

async function pdf(n: number) {
  const d = await PDFDocument.create();
  for (let i = 0; i < n; i++) d.addPage([200 + i * 10, 300]);
  return d.save();
}
const widths = async (b: Uint8Array) => (await PDFDocument.load(b)).getPages().map((p) => p.getWidth());

describe("client-side page ops (no server)", () => {
  it("rotate / reorder / delete / duplicate / insert", async () => {
    const b = await pdf(3);
    expect((await PDFDocument.load(await rotateLocal(b, [2], 90))).getPage(1).getRotation().angle).toBe(90);
    expect((await PDFDocument.load(await rotateLocal(b, [1], -90))).getPage(0).getRotation().angle).toBe(270);
    expect(await widths(await reorderLocal(b, [3, 1, 2]))).toEqual([220, 200, 210]);
    expect(await widths(await deleteLocal(b, [1, 3]))).toEqual([210]);
    await expect(deleteLocal(b, [1, 2, 3])).rejects.toThrow(/every page/);
    expect(await widths(await duplicateLocal(b, [2]))).toEqual([200, 210, 210, 220]);
    expect(await widths(await insertBlankLocal(b, 1))).toEqual([200, 200, 210, 220]);
  });
  it("copies pages and pastes them after a page", async () => {
    const b = await pdf(3);
    const clip = await extractLocal(b, [3]);
    expect(await widths(await insertPdfLocal(b, clip, 1))).toEqual([200, 220, 210, 220]);
    expect(await widths(await insertPdfLocal(b, clip, 0))).toEqual([220, 200, 210, 220]);
  });
});

describe("annotation clipboard", () => {
  it("pastes copied annotations with new ids, offset, onto another page", async () => {
    const base = await pdf(2);
    const { bytes, ids } = await addAnnotations(base, [{ type: "square", page: 0, author: "A", color: [1, 0, 0], rect: { x: 10, y: 20, width: 50, height: 40 }, contents: "box" }]);
    setClip({ kind: "annots", source: bytes, ids, fromPage: 0 });
    expect(getClip()?.kind).toBe("annots");
    const off = nextPasteOffset(false); // different page: no offset on first paste
    expect(off).toBe(0);
    const r = await pasteAnnotations(bytes, bytes, ids, 1, 12);
    const all = await readAnnotations(r.bytes);
    expect(all).toHaveLength(2);
    const pasted = all.find((a) => a.page === 1)!;
    expect(pasted.id).toBe(r.ids[0]); expect(pasted.id).not.toBe(ids[0]);
    expect(pasted.subtype).toBe("Square"); expect(pasted.contents).toBe("box");
    const orig = all.find((a) => a.page === 0)!;
    expect(pasted.rect.x).toBeCloseTo(orig.rect.x + 12); expect(pasted.rect.y).toBeCloseTo(orig.rect.y - 12);
  });
  it("successive pastes on the same page step further", () => {
    setClip({ kind: "pages", pdf: new Uint8Array(), count: 1 });
    expect([nextPasteOffset(true), nextPasteOffset(true)]).toEqual([12, 24]);
  });
});
