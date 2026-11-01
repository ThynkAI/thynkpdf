// @vitest-environment node
/**
 * Live contract test against the dev backend (http://localhost:8000). Skipped automatically if the API is down.
 * Credentials: dev-only account documented in docs/integration-for-bot1.md (override via THYNKPDF_DEV_EMAIL/PASSWORD).
 */
import { readFileSync } from "node:fs";
import { PDFDocument } from "pdf-lib";
import { HttpEditorApi, VersionConflictError } from "./http";

const BASE = process.env.THYNKPDF_API_URL ?? "http://localhost:8000";
const up = await fetch(BASE + "/health").then((r) => r.ok, () => false);
const fixture = readFileSync(new URL("../../backend-tests/fixtures/simple-3page.pdf", import.meta.url));

describe.skipIf(!up)("live API: upload -> rotate -> reload", () => {
  it("persists rotation as a new version, serves Range, rejects stale versions with 409", async () => {
    const api = new HttpEditorApi({ baseUrl: BASE });
    api.setTokens(await api.localSession("live-test-browser-key-0123456789abcdef"));  // no accounts: anonymous workspace
    const u = await api.upload(new Blob([fixture], { type: "application/pdf" }), "simple-3page.pdf");
    expect(u.page_count).toBe(3);
    const ref = { document_id: u.document_id, version_id: u.version_id, version: u.version };
    const r = await api.rotatePages(ref, [2], 90);
    expect(r.version).toBe(u.version + 1);
    const src = (await api.fileSource(r)) as { url: string; httpHeaders: Record<string, string> };
    const part = await fetch(src.url, { headers: { ...src.httpHeaders, Range: "bytes=0-99" } });
    expect(part.status).toBe(206);
    const full = new Uint8Array(await (await fetch(src.url, { headers: src.httpHeaders })).arrayBuffer());
    const pdf = await PDFDocument.load(full);
    expect(pdf.getPage(1).getRotation().angle).toBe(90);
    expect(pdf.getPage(0).getRotation().angle).toBe(0);
    const err = await api.rotatePages(ref, [1], 90).catch((e) => e);
    expect(err).toBeInstanceOf(VersionConflictError);
    expect(err.currentVersion).toBe(r.version);
    const doc = await api.getDocument(u.document_id);
    expect(doc.current_version).toBe(r.version);
    const caps = await api.getCapabilities(u.document_id);
    expect(caps.version).toBe(r.version);
    expect(caps.page_ops.reorder).toBe(true);
    const ro = await api.reorderPages({ ...r, version: r.version }, [3, 1, 2]);
    expect(ro.version).toBe(r.version + 1);
    const pdf2 = await PDFDocument.load(new Uint8Array(await (await fetch(((await api.fileSource(ro)) as { url: string }).url, { headers: src.httpHeaders })).arrayBuffer()));
    expect(pdf2.getPage(1).getRotation().angle).toBe(0);
    expect(pdf2.getPage(2).getRotation().angle).toBe(90); // old page 2 (rotated) is now page 3
  });

  it("text edit, extract, split, merge, metadata, versions", async () => {
    const api = new HttpEditorApi({ baseUrl: BASE });
    api.setTokens(await api.localSession("live-test-browser-key-0123456789abcdef"));  // no accounts: anonymous workspace
    const u = await api.upload(new Blob([fixture], { type: "application/pdf" }), "simple-3page.pdf");
    const ref = { document_id: u.document_id, version_id: u.version_id, version: u.version };
    const e = await api.editText(ref, [{ op: "text_replace", page: 1, find: "ACME-001", replacement: "EDIT-001", occurrence: "all" }]);
    expect(e.version).toBe(2);
    expect((e.report as any).applied[0].count).toBe(1);
    const miss = await api.editText({ ...ref, version_id: e.version_id, version: 2 }, [{ op: "text_replace", page: 1, find: "NOPE", replacement: "x", occurrence: "all" }]).catch((x) => x);
    expect(miss.code).toBe("TEXT_NOT_FOUND");
    const meta = await api.getMetadata(u.document_id, 2);
    expect(meta.pages).toHaveLength(3);
    const ex = await api.extractPages(u.document_id, [2, 3]);
    expect(ex.page_count).toBe(2);
    const sp = await api.splitDocument(u.document_id, [[1, 1], [2, 3]]);
    expect(sp.map((x) => x.page_count)).toEqual([1, 2]);
    const mg = await api.mergeDocuments([u.document_id, ex.document_id], "m.pdf");
    expect(mg.page_count).toBe(5);
    expect((await api.listVersions(u.document_id)).length).toBe(2);
    expect((await api.listDocuments({ limit: 200 })).items.some((d) => d.document_id === mg.document_id)).toBe(true);
  });
});
