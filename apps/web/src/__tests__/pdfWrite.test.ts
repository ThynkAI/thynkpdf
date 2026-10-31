// @vitest-environment node
import { readFileSync } from "node:fs";
import { PDFDocument, PDFName, PDFDict } from "pdf-lib";
import { cssToPdfRect, stampImage, listFields, fillFields, addField, pageInfo } from "@/lib/pdfWrite";
const fx = (n: string) => new Uint8Array(readFileSync(new URL(`../../../../packages/frontend-tests/fixtures/${n}`, import.meta.url)));
// 1x1 transparent PNG
const PNG = Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=="), (c) => c.charCodeAt(0));

describe("pdfWrite", () => {
  it("converts CSS box to PDF rect", () => {
    expect(cssToPdfRect({ left: 100, top: 50, width: 200, height: 100 }, 2, 792)).toEqual({ x: 50, y: 792 - 75, width: 100, height: 50 });
  });
  it("stamps an image XObject onto the page", async () => {
    const out = await stampImage(fx("sample-12p.pdf"), 0, { x: 72, y: 72, width: 100, height: 40 }, PNG, "image/png");
    const pdf = await PDFDocument.load(out);
    const xo = pdf.getPage(0).node.Resources()!.lookup(PDFName.of("XObject"), PDFDict);
    expect(xo.keys().length).toBeGreaterThan(0);
    expect(pdf.getPageCount()).toBe(12);
  });
  it("refuses rotated pages", async () => {
    const pdf = await PDFDocument.load(fx("sample-12p.pdf")); pdf.getPage(0).setRotation({ type: "degrees", angle: 90 } as never);
    const b = await pdf.save();
    expect((await pageInfo(b, 0)).rotation).toBe(90);
    await expect(stampImage(b, 0, { x: 0, y: 0, width: 1, height: 1 }, PNG, "image/png")).rejects.toThrow(/rotated/);
  });
  it("lists, fills and adds AcroForm fields", async () => {
    const f = await listFields(fx("form-fields.pdf"));
    expect(f.map((x) => [x.name, x.type])).toEqual([["full_name", "text"], ["agree", "checkbox"], ["country", "dropdown"]]);
    const filled = await fillFields(fx("form-fields.pdf"), { full_name: "Ada Lovelace", agree: true, country: "Canada" });
    expect((await listFields(filled)).map((x) => x.value)).toEqual(["Ada Lovelace", true, "Canada"]);
    const added = await addField(filled, { name: "notes", type: "text", pageIndex: 0, rect: { x: 72, y: 100, width: 200, height: 20 } });
    expect((await listFields(added)).map((x) => x.name)).toContain("notes");
    await expect(addField(added, { name: "notes", type: "text", pageIndex: 0, rect: { x: 0, y: 0, width: 1, height: 1 } })).rejects.toThrow(/already exists/);
  });
});
