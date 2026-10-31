// @vitest-environment node
import { readFileSync } from "node:fs";
import { PDFDocument } from "pdf-lib";
import { MockEditorApi } from "./mockApi";
const fixture = readFileSync(new URL("../../../frontend-tests/fixtures/sample-12p.pdf", import.meta.url));
describe("MockEditorApi (mock layer)", () => {
  it("upload -> rotate returns a new version with the page rotated; old version untouched", async () => {
    const api = new MockEditorApi();
    const ref = await api.upload(new Blob([fixture]), "s.pdf");
    const next = await api.rotatePages(ref, [2], 90);
    expect(next.version).toBe(2);
    await expect(api.rotatePages(ref, [2], 90)).rejects.toMatchObject({ code: "VERSION_CONFLICT" });
    expect(next.document_id).toBe(ref.document_id); expect(next.version_id).not.toBe(ref.version_id);
    const src = (await api.fileSource(next)) as { data: Uint8Array };
    const doc = await PDFDocument.load(src.data);
    expect(doc.getPage(1).getRotation().angle).toBe(90);
    expect(doc.getPage(0).getRotation().angle).toBe(0);
    const old = (await api.fileSource(ref)) as { data: Uint8Array };
    expect((await PDFDocument.load(old.data)).getPage(1).getRotation().angle).toBe(0);
  });
  it("rejects non-PDF uploads", async () => {
    await expect(new MockEditorApi().upload(new Blob(["hello"]), "x.pdf")).rejects.toThrow();
  });
});
