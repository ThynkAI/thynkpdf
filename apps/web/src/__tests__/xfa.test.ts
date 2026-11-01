// @vitest-environment node
import { readFileSync } from "node:fs";
import { PDFDocument } from "pdf-lib";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import { hasXfa, stampImage, fillFieldsWithReport, addField } from "@/lib/pdfWrite";
import { addAnnotations } from "@/lib/annotWrite";
import { classifyXfa } from "@thynkpdf/pdf-viewer";
const fx = (n: string) => new Uint8Array(readFileSync(new URL(`../../../../packages/frontend-tests/fixtures/${n}`, import.meta.url)));
const PNG = Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=="), (c) => c.charCodeAt(0));
const open = (b: Uint8Array) => pdfjs.getDocument({ data: b.slice(), enableXfa: true, isEvalSupported: false }).promise;
async function mode(b: Uint8Array) {
  const d = await open(b);
  const info = (await d.getMetadata()).info as { IsXFAPresent?: boolean };
  const tc = d.isPureXfa ? { items: [] } : await (await d.getPage(1)).getTextContent();
  return classifyXfa({ isPureXfa: d.isPureXfa, xfaPresent: !!info.IsXFAPresent, firstPageText: tc.items.map((i) => ("str" in i ? i.str : "")).join(" ") });
}

describe("XFA forms", () => {
  it("dynamic XFA renders via PDF.js XFA layout instead of the 'Please wait' placeholder", async () => {
    const d = await open(fx("xfa-dynamic.pdf"));
    expect(d.isPureXfa).toBe(true);
    const html = JSON.stringify(await (await d.getPage(1)).getXfa());
    expect(html).toContain("XFA Test Application");
    expect(html).toContain("Jane Prefilled");
    expect(html).not.toContain("Please wait");
    expect(await mode(fx("xfa-dynamic.pdf"))).toBe("pure");
  });
  it("hybrid XFA+AcroForm falls back to the AcroForm; plain PDFs are 'none'", async () => {
    expect(await mode(fx("xfa-hybrid.pdf"))).toBe("hybrid");
    expect(await mode(fx("form-fields.pdf"))).toBe("none");
  });
  it("without XFA support the same file only shows the placeholder (regression guard)", async () => {
    const d = await pdfjs.getDocument({ data: fx("xfa-dynamic.pdf"), enableXfa: false }).promise;
    const tc = await (await d.getPage(1)).getTextContent();
    expect(classifyXfa({ isPureXfa: d.isPureXfa, xfaPresent: true, firstPageText: tc.items.map((i) => ("str" in i ? i.str : "")).join(" ") })).toBe("unrendered");
  });
  it("values typed into the XFA layer (annotationStorage) are saved into the XFA datasets", async () => {
    const d = await open(fx("xfa-dynamic.pdf"));
    const walk = (n: any, out: any[] = []): any[] => { if (n?.attributes?.dataId) out.push(n.attributes); (n?.children ?? []).forEach((c: any) => walk(c, out)); return out; };
    const inputs = walk(await (await d.getPage(1)).getXfa());
    const city = inputs.find((a) => String(a.dataId).startsWith("City"));
    d.annotationStorage.setValue(city.dataId, { value: "Guelph" });
    const saved = await d.saveDocument();
    const d2 = await open(saved);
    expect(d2.isPureXfa).toBe(true);
    expect(JSON.stringify(await (await d2.getPage(1)).getXfa())).toContain('"value":"Guelph"');
  });
  it("pdf-lib stamp/annotation/add-field writes preserve XFA instead of silently deleting it", async () => {
    const b = fx("xfa-dynamic.pdf");
    expect(hasXfa(await PDFDocument.load(b))).toBe(true);
    const stamped = await stampImage(b, 0, { x: 72, y: 72, width: 50, height: 20 }, PNG, "image/png");
    expect(hasXfa(await PDFDocument.load(stamped))).toBe(true);
    expect((await open(stamped)).isPureXfa).toBe(true);
    const annotated = (await addAnnotations(b, [{ type: "note", page: 0, at: [72, 700], contents: "hi", author: "t", color: [1, 0.8, 0] } as never])).bytes;
    expect(hasXfa(await PDFDocument.load(annotated))).toBe(true);
    const withField = await addField(fx("xfa-hybrid.pdf"), { name: "extra", type: "text", pageIndex: 0, rect: { x: 72, y: 400, width: 100, height: 20 } });
    expect(hasXfa(await PDFDocument.load(withField))).toBe(true);
  });
  it("AcroForm fill on a hybrid form removes XFA explicitly and reports it", async () => {
    const r = await fillFieldsWithReport(fx("xfa-hybrid.pdf"), { "form1[0].body[0].FullName[0]": "Deep" });
    expect(r.xfaRemoved).toBe(true);
    const pdf = await PDFDocument.load(r.bytes);
    expect(hasXfa(pdf)).toBe(false);
    expect(pdf.getForm().getTextField("form1[0].body[0].FullName[0]").getText()).toBe("Deep");
    expect((await fillFieldsWithReport(fx("form-fields.pdf"), { full_name: "x" })).xfaRemoved).toBe(false);
  });
});
