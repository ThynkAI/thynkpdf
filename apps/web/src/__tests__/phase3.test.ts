import { readFileSync } from "node:fs";
import { PDFDocument, PDFName, PDFArray, PDFDict, PDFNumber, degrees } from "pdf-lib";
import { toServer, fromServer, serverThreads, serverCanWrite, STAMP_NAME } from "@/lib/annotServer";
import { addAnnotations, isWinAnsi, rotMatrix, unicodeFont, readAnnotations } from "@/lib/annotWrite";

unicodeFont.load = async () => new Uint8Array(readFileSync(`${process.cwd()}/public/fonts/NotoSans-Regular.ttf`));
const base = { author: "Ada", color: [1, 0, 0] as [number, number, number] };

describe("server annotation mapping", () => {
  it("maps editor annotations to the API (1-based pages, rect arrays, quads, ink, line, stamps)", () => {
    expect(toServer({ ...base, page: 0, type: "square", rect: { x: 10, y: 20, width: 30, height: 40 } })).toMatchObject({ page: 1, type: "square", rect: [10, 20, 40, 60], color: [1, 0, 0], author: "Ada" });
    const hl = toServer({ ...base, page: 2, type: "highlight", quads: [{ x: 0, y: 0, width: 10, height: 5 }] });
    expect(hl).toMatchObject({ page: 3, quad_points: [0, 5, 10, 5, 0, 0, 10, 0], rect: [0, 0, 10, 5] });
    expect(toServer({ ...base, page: 0, type: "arrow", from: [0, 0], to: [10, 10] })).toMatchObject({ type: "arrow", line: [0, 0, 10, 10] });
    expect(toServer({ ...base, page: 0, type: "note", at: [50, 100] })).toMatchObject({ type: "text", rect: [50, 80, 70, 100] });
    expect(toServer({ ...base, page: 0, type: "stamp", rect: { x: 0, y: 0, width: 100, height: 30 }, label: "APPROVED" })).toMatchObject({ stamp_name: "Approved" });
    expect(toServer({ ...base, page: 0, type: "ink", paths: [[[0, 0], [5, 5]]] })).toMatchObject({ ink_list: [[[0, 0], [5, 5]]] });
    expect(Object.keys(STAMP_NAME)).toHaveLength(6);
  });
  it("routes Unicode text, callouts and rotated text to the browser writer", () => {
    const ft = { ...base, page: 0, type: "freetext" as const, rect: { x: 0, y: 0, width: 50, height: 20 }, text: "Hello" };
    expect(serverCanWrite(ft, 0)).toBe(true);
    expect(serverCanWrite({ ...ft, text: "Привет" }, 0)).toBe(false);
    expect(serverCanWrite(ft, 90)).toBe(false);
    expect(serverCanWrite({ ...base, page: 0, type: "square", rect: ft.rect }, 90)).toBe(true);
    expect(serverCanWrite({ ...ft, type: "callout", anchor: [0, 0] }, 0)).toBe(false);
  });
  it("builds threads from in_reply_to with resolve state on the root; hides unsupported", () => {
    const all = fromServer([
      { id: "a", page: 1, type: "square", rect: [0, 0, 1, 1], color: [1, 0, 0], state: "resolved", modified_at: "2026-10-31T18:00:00+00:00", supported: true },
      { id: "r1", page: 1, type: "text", rect: [0, 0, 1, 1], color: [1, 0, 0], in_reply_to: "a", contents: "ok", author: "B", created_at: "2026-10-31T18:01:00+00:00", supported: true },
      { id: "l", page: 1, type: "link", rect: [0, 0, 1, 1], color: [0, 0, 0], supported: false },
    ] as never);
    const t = serverThreads(all);
    expect(t).toHaveLength(1);
    expect(t[0]).toMatchObject({ resolved: true, root: { id: "a", page: 0, subtype: "Square" } });
    expect(t[0].replies.map((r) => r.contents)).toEqual(["ok"]);
  });
});

describe("Unicode + rotation in browser-written annotations", () => {
  it("detects WinAnsi", () => { expect(isWinAnsi("Café – “ok” €")).toBe(true); expect(isWinAnsi("Ελληνικά")).toBe(false); expect(isWinAnsi("日本")).toBe(false); });
  it("embeds Noto Sans for non-Latin-1 text and keeps the text readable", async () => {
    const pdf = await PDFDocument.create(); pdf.addPage([400, 400]);
    const { bytes } = await addAnnotations(await pdf.save(), [{ ...base, page: 0, type: "freetext", rect: { x: 20, y: 300, width: 200, height: 40 }, text: "Привет, Ελλάδα ✓", contents: "Привет, Ελλάδα" }]);
    const doc = await PDFDocument.load(bytes);
    const fonts = doc.context.enumerateIndirectObjects().map(([, o]) => (o instanceof PDFDict ? o.get(PDFName.of("BaseFont"))?.toString() : undefined)).filter(Boolean);
    expect(fonts.some((f) => /NotoSans/.test(f!))).toBe(true);
    expect((await readAnnotations(bytes))[0].contents).toBe("Привет, Ελλάδα");
  });
  it("rotates free text appearance with /Matrix on rotated pages", async () => {
    const pdf = await PDFDocument.create(); pdf.addPage([300, 500]).setRotation(degrees(90));
    const { bytes } = await addAnnotations(await pdf.save(), [{ ...base, page: 0, type: "freetext", rect: { x: 100, y: 100, width: 30, height: 150 }, text: "Upright" }]);
    const doc = await PDFDocument.load(bytes);
    const annot = doc.getPage(0).node.lookup(PDFName.of("Annots"), PDFArray).lookup(0, PDFDict);
    const ap = annot.lookup(PDFName.of("AP"), PDFDict).lookup(PDFName.of("N")) as unknown as { dict: PDFDict };
    const m = ap.dict.lookup(PDFName.of("Matrix"), PDFArray).asArray().map((x) => (x as PDFNumber).asNumber());
    expect(m).toEqual(rotMatrix(90));
    const bb = ap.dict.lookup(PDFName.of("BBox"), PDFArray).asArray().map((x) => (x as PDFNumber).asNumber());
    expect(bb).toEqual([0, 0, 150, 30]); // visual width = rect height on a 90° page
  });
});

import { parseTool, toolAction } from "@/lib/tools";
describe("?tool= deep links", () => {
  it("parses known tools case-insensitively and ignores unknown", () => {
    expect(parseTool("?tool=Sign")).toBe("sign");
    expect(parseTool("?doc=1&tool=merge-split")).toBe("merge-split");
    expect(parseTool("?tool=hack")).toBeNull();
    expect(parseTool("")).toBeNull();
  });
  it("maps every tool to an action", () => {
    expect(toolAction("compress")).toEqual({ organizer: "compress" });
    expect(toolAction("comment")).toEqual({ panelSection: "cm-h", annotate: true });
    expect(toolAction("documents")).toEqual({ navigate: "/documents" });
    expect(toolAction("edit").panelSection).toBe("te-h");
  });
});
