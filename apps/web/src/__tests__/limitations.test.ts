import { friendlyNotices, friendlyReason, friendlyText, SIGNED_TEXT, FONTS_TEXT, isSigned } from "@/lib/limitations";
import { editGate, textEditGate } from "@/lib/gates";
import type { Capabilities } from "@thynkpdf/editor-client";

const SIGNED = { code: "SIGNED_DOCUMENT", message: "Edits invalidate existing signatures; content edits disabled." };
const F1 = { code: "FONT_NOT_SIMPLE_TYPE1", message: "Font IXQQXX+ArialMT (/TT0) not safely editable" };
const F2 = { code: "FONT_NOT_STANDARD_14", message: "Font Foo (/F2) not safely editable" };

describe("friendly limitation copy", () => {
  it("maps signed documents to plain language, never the raw code", () => {
    expect(friendlyText(SIGNED)).toBe(SIGNED_TEXT);
    expect(friendlyReason([SIGNED])).not.toMatch(/SIGNED_DOCUMENT|invalidate/);
    expect(isSigned([SIGNED])).toBe(true);
  });
  it("collapses all font codes into one notice with technical details", () => {
    const n = friendlyNotices([F1, F2, F1]);
    expect(n).toHaveLength(1);
    expect(n[0].text).toBe(FONTS_TEXT);
    expect(n[0].details).toEqual([`FONT_NOT_SIMPLE_TYPE1: ${F1.message}`, `FONT_NOT_STANDARD_14: ${F2.message}`]);
  });
  it("de-duplicates and keeps unknown codes' backend message", () => {
    const n = friendlyNotices([SIGNED, SIGNED, { code: "ROLE_READ_ONLY", message: "Your role is read-only." }]);
    expect(n.map((x) => x.text)).toEqual([SIGNED_TEXT, "Your role is read-only."]);
  });
});

const ref = { document_id: "d", version_id: "v", version: 2 };
const off = { rotate: false, reorder: false, extract: true, split: true, merge: true, delete: false, duplicate: false, insert_blank: false };
const caps: Capabilities = { document_id: "d", version: 2, version_id: "v", page_ops: off, compress: true, text_replace: false,
  edit_ops: { text_replace: false, text_delete: false, text_move: false, text_insert: false }, annotations: true, forms: true,
  document_limitations: [SIGNED], pages: [{ number: 1, text_replace: false, text_delete: false, text_move: false, limitations: [F1] }] as unknown as Capabilities["pages"], safe_alternatives: [] };

describe("gates use friendly reasons (backend decision unchanged)", () => {
  it("signed doc disables page ops with friendly text", () => expect(editGate("rotate", ref, caps)).toEqual({ enabled: false, reason: SIGNED_TEXT }));
  it("text edit gate stays disabled", () => expect(textEditGate(1, ref, caps)).toEqual({ enabled: false, reason: SIGNED_TEXT }));
});
