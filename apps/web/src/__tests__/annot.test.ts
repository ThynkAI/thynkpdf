// @vitest-environment node
import { readFileSync } from "node:fs";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { displayToPdf, pdfToDisplay, uprightImagePlacement } from "@/lib/geometry";
import { addAnnotations, readAnnotations, buildThreads, addReply, setReviewState, deleteAnnotation, parsePdfDate, pdfDate } from "@/lib/annotWrite";

const fx = new Uint8Array(readFileSync(new URL("../../../../packages/frontend-tests/fixtures/sample-12p.pdf", import.meta.url)));

describe("geometry matches PDF.js PageViewport", () => {
  for (const rotation of [0, 90, 180, 270]) {
    it(`rotation ${rotation}`, async () => {
      const page = await (await getDocument({ data: fx.slice(), isEvalSupported: false }).promise).getPage(1);
      const vp = page.getViewport({ scale: 1.5, rotation });
      const g = { width: 612, height: 792, rotation };
      for (const [x, y] of [[0, 0], [100, 37], [400, 900]]) {
        const ours = displayToPdf(x, y, g, 1.5); const theirs = vp.convertToPdfPoint(x, y);
        expect(ours[0]).toBeCloseTo(theirs[0], 6); expect(ours[1]).toBeCloseTo(theirs[1], 6);
        const back = pdfToDisplay(ours[0], ours[1], g, 1.5);
        expect(back[0]).toBeCloseTo(x, 6); expect(back[1]).toBeCloseTo(y, 6);
      }
    });
  }
  it("upright image placement rotates CCW by page rotation", () => {
    const p = uprightImagePlacement(10, 10, 100, 50, { width: 612, height: 792, rotation: 90 }, 1);
    expect(p).toEqual({ x: 60, y: 10, width: 100, height: 50, rotate: 90 });
  });
});

describe("PDF annotations", () => {
  it("dates round-trip", () => { const d = new Date("2026-10-31T17:05:09Z"); expect(parsePdfDate(pdfDate(d))!.toISOString()).toBe(d.toISOString()); expect(parsePdfDate("D:20261031130135-04'00'")!.toISOString()).toBe("2026-10-31T17:01:35.000Z"); });

  it("writes every type with identity/timestamps, threads, resolve/reopen, delete; PDF.js parses them", async () => {
    const base = { author: "Ada", color: [1, 0.8, 0] as [number, number, number], page: 0 };
    const r = { x: 72, y: 600, width: 120, height: 40 };
    const { bytes, ids } = await addAnnotations(fx, [
      { ...base, type: "highlight", quads: [{ x: 72, y: 690, width: 200, height: 28 }], contents: "important" },
      { ...base, type: "underline", quads: [{ x: 72, y: 640, width: 200, height: 14 }] },
      { ...base, type: "strikeout", quads: [{ x: 72, y: 620, width: 200, height: 14 }] },
      { ...base, type: "ink", paths: [[[100, 100], [120, 130], [140, 100]]] },
      { ...base, type: "note", at: [500, 700], contents: "Check this" },
      { ...base, type: "freetext", rect: r, text: "Free text comment" },
      { ...base, type: "callout", rect: { ...r, x: 300 }, anchor: [250, 500], text: "Callout" },
      { ...base, type: "square", rect: { x: 80, y: 300, width: 60, height: 40 } },
      { ...base, type: "circle", rect: { x: 160, y: 300, width: 60, height: 40 } },
      { ...base, type: "line", from: [80, 250], to: [200, 260] },
      { ...base, type: "arrow", from: [80, 230], to: [200, 230] },
      { ...base, type: "stamp", rect: { x: 400, y: 300, width: 150, height: 44 }, label: "APPROVED" },
    ]);
    let b = (await addReply(bytes, ids[4], "Grace", "Agreed", new Date("2026-10-31T18:00:00Z"))).bytes;
    b = (await setReviewState(b, ids[4], "Grace", true, new Date("2026-10-31T18:01:00Z"))).bytes;
    let threads = buildThreads(await readAnnotations(b));
    const note = threads.find((t) => t.root.id === ids[4])!;
    expect(note.root).toMatchObject({ subtype: "Text", author: "Ada", contents: "Check this" });
    expect(note.root.created).toBeInstanceOf(Date);
    expect(note.replies.map((x) => [x.author, x.contents])).toEqual([["Grace", "Agreed"]]);
    expect(note.resolved).toBe(true);
    b = (await setReviewState(b, ids[4], "Ada", false, new Date("2026-10-31T18:02:00Z"))).bytes;
    expect(buildThreads(await readAnnotations(b)).find((t) => t.root.id === ids[4])!.resolved).toBe(false);
    threads = buildThreads(await readAnnotations(b));
    expect(threads).toHaveLength(12);

    // Independent parser: PDF.js
    const pdf = await getDocument({ data: b.slice(), isEvalSupported: false }).promise;
    const anns = await (await pdf.getPage(1)).getAnnotations();
    const types = anns.map((a: any) => a.subtype);
    for (const t of ["Highlight", "Underline", "StrikeOut", "Ink", "Text", "FreeText", "Square", "Circle", "Line", "Stamp"]) expect(types).toContain(t);
    const reply = anns.find((a: any) => a.inReplyTo && a.replyType === "R");
    expect(reply.titleObj.str).toBe("Grace");
    expect(anns.find((a: any) => a.id === reply.inReplyTo).contentsObj.str).toBe("Check this");
    expect(anns.filter((a: any) => a.subtype !== "Text").every((a: any) => a.hasAppearance)).toBe(true);

    // eraser removes thread
    const after = await deleteAnnotation(b, ids[4]);
    const left = await readAnnotations(after);
    expect(left.some((a) => a.id === ids[4] || a.inReplyTo === ids[4])).toBe(false);
    expect(left).toHaveLength(11);
  });
});
