import { parseRanges } from "@/lib/ranges";
import { textEditGate } from "@/lib/gates";
import { sizesFromMetadata } from "@thynkpdf/pdf-viewer/client";
import type { Capabilities } from "@thynkpdf/editor-client";

describe("parseRanges", () => {
  it("parses pages and ranges", () => expect(parseRanges("1-2, 3 ,5-5", 5)).toEqual({ ranges: [[1, 2], [3, 3], [5, 5]] }));
  it.each(["", "a", "0-1", "2-1", "1-9"])("rejects %j", (s) => expect(parseRanges(s, 5)).toHaveProperty("error"));
});

describe("textEditGate", () => {
  const ref = { document_id: "d", version_id: "v", version: 1 };
  const caps = (p: Partial<Capabilities["pages"][0]>, o: Partial<Capabilities> = {}): Capabilities => ({ document_id: "d", version: 1, version_id: "v",
    page_ops: { rotate: false, reorder: true, extract: true, split: true, merge: true, delete: true, duplicate: true, insert_blank: true }, compress: true, text_replace: true, edit_ops: { text_replace: true, text_delete: false, text_move: false, text_insert: false }, annotations: true, forms: true, document_limitations: [],
    pages: [{ number: 1, text_replace: true, text_delete: false, text_move: false, text_insert: false, editable_fonts: [], limitations: [], ...p }], safe_alternatives: [], ...o });
  it("enabled for editable page even if rotate is off", () => expect(textEditGate(1, ref, caps({})).enabled).toBe(true));
  it("explains per-page limitations", () => {
    expect(textEditGate(1, ref, caps({ text_replace: false, limitations: [{ code: "NO_TEXT_LAYER", message: "No text layer." }] })).reason).toBe("No text layer.");
  });
  it("document-level off", () => expect(textEditGate(1, ref, caps({}, { text_replace: false, document_limitations: [{ code: "PDFA", message: "PDF/A." }] })).reason).toBe("PDF/A."));
  it("requires server doc", () => expect(textEditGate(1, null, null).enabled).toBe(false));
});

describe("sizesFromMetadata", () => {
  it("swaps width/height for 90/270 rotation", () => {
    expect(sizesFromMetadata([{ width: 600, height: 800, rotation: 90 }, { width: 600, height: 800, rotation: 180 }, { width: 600, height: 800, rotation: -90 }]))
      .toEqual([{ width: 800, height: 600 }, { width: 600, height: 800 }, { width: 800, height: 600 }]);
  });
});
