import { editGate } from "@/lib/gates";
import type { Capabilities } from "@thynkpdf/editor-client";
const ref = { document_id: "d", version_id: "v", version: 2 };
const caps = (o: Partial<Capabilities> = {}): Capabilities => ({ document_id: "d", version: 2, version_id: "v",
  page_ops: { rotate: true, reorder: true, extract: true, split: true, merge: true, delete: true, duplicate: true, insert_blank: true }, compress: true, text_replace: true, edit_ops: { text_replace: true, text_delete: false, text_move: false, text_insert: false }, annotations: true, forms: true,
  document_limitations: [], pages: [], safe_alternatives: [], ...o });
describe("editGate", () => {
  it("requires a server document", () => expect(editGate("rotate", null, null).reason).toMatch(/server/));
  it("waits for capabilities of the current version", () => {
    expect(editGate("rotate", ref, null).reason).toMatch(/Checking/);
    expect(editGate("rotate", ref, caps({ version: 1 })).enabled).toBe(false);
  });
  it("enables when allowed", () => expect(editGate("reorder", ref, caps())).toEqual({ enabled: true, reason: null }));
  it("explains backend limitations", () => {
    const g = editGate("rotate", ref, caps({ page_ops: { rotate: false, reorder: false, extract: true, split: true, merge: true, delete: true, duplicate: true, insert_blank: true },
      document_limitations: [{ code: "ROLE_READ_ONLY", message: "Your role is read-only." }] }));
    expect(g).toEqual({ enabled: false, reason: "Your role is read-only." });
  });
  it("busy and errors disable", () => {
    expect(editGate("rotate", ref, caps(), { busy: true }).enabled).toBe(false);
    expect(editGate("rotate", ref, caps(), { capsError: "boom" }).reason).toMatch(/boom/);
  });
});
