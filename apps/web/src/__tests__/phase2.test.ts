import { fitPixels } from "@/lib/png";
import { buildRequestFields, isEmail } from "@/lib/requestFields";
import { secondsLeft } from "@/lib/aiRetry";
import { editGate } from "@/lib/gates";
import type { Capabilities } from "@thynkpdf/editor-client";

describe("signature PNG sizing", () => {
  it("keeps ≤ 4 MP and aspect", () => {
    const r = fitPixels(4000, 2000); expect(r.width * r.height).toBeLessThanOrEqual(4_000_000); expect(r.width / r.height).toBeCloseTo(2, 1);
    expect(fitPixels(600, 200)).toEqual({ width: 600, height: 200 });
  });
});
describe("signature request fields", () => {
  it("one signature (+date) per signer, stacked, PDF rects", () => {
    const f = buildRequestFields(2, 3, { x: 72, y: 72, width: 200, height: 40 }, true, 612);
    expect(f).toHaveLength(4);
    expect(f[0]).toEqual({ signer_index: 0, page: 3, rect: [72, 72, 272, 112], type: "signature" });
    expect(f[2].rect[1]).toBe(124);
    expect(f[1].type).toBe("date"); expect(f[1].rect[2]).toBeLessThanOrEqual(612);
    expect(buildRequestFields(1, 1, { x: 0, y: 0, width: 10, height: 10 }, false, 612)).toHaveLength(1);
  });
  it("validates emails", () => { expect(isEmail("a@b.co")).toBe(true); expect(isEmail("nope")).toBe(false); });
});
describe("AI rate limit countdown", () => {
  it("counts down", () => { expect(secondsLeft(10_500, 1_000)).toBe(10); expect(secondsLeft(null)).toBe(0); expect(secondsLeft(500, 1_000)).toBe(0); });
});
describe("page structure gates", () => {
  const caps: Capabilities = { document_id: "d", version: 1, version_id: "v", compress: true, text_replace: false, annotations: true, forms: true,
    edit_ops: { text_replace: false, text_delete: false, text_move: false, text_insert: false },
    page_ops: { rotate: true, reorder: true, extract: true, split: true, merge: true, delete: false, duplicate: true, insert_blank: true },
    document_limitations: [], pages: [], safe_alternatives: [] };
  const ref = { document_id: "d", version_id: "v", version: 1 };
  it("follows capabilities", () => {
    expect(editGate("duplicate", ref, caps).enabled).toBe(true);
    expect(editGate("delete", ref, caps)).toEqual({ enabled: false, reason: "This document does not allow delete." });
    expect(editGate("insert_blank", null, caps).enabled).toBe(false);
  });
});
