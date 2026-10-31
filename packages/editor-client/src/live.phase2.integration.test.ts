// @vitest-environment node
/** Live contract test for the phase-2 endpoints (page structure, versions, annotations, forms, signing, audit, doc mgmt, AI). Skipped if the API is down. */
import { readFileSync } from "node:fs";
import { PDFDocument } from "pdf-lib";
import { HttpEditorApi, DocumentSignedError, VersionConflictError } from "./http";
import type { DocumentRef, VersionResult } from "./types";

const BASE = process.env.THYNKPDF_API_URL ?? "http://localhost:8000";
const up = await fetch(BASE + "/health").then((r) => r.ok, () => false);
const fixture = readFileSync(new URL("../../backend-tests/fixtures/simple-3page.pdf", import.meta.url));
const r = (v: VersionResult): DocumentRef => ({ document_id: v.document_id, version_id: v.version_id, version: v.version });
async function fresh(name = "p2.pdf") {
  const api = new HttpEditorApi({ baseUrl: BASE });
  await api.login(process.env.THYNKPDF_DEV_EMAIL ?? "dev@thynkpdf.dev", process.env.THYNKPDF_DEV_PASSWORD ?? "ThynkDev-2026!");
  const u = await api.upload(new Blob([fixture], { type: "application/pdf" }), name);
  return { api, ref: { document_id: u.document_id, version_id: u.version_id, version: u.version } };
}
// 1x1 PNG
const PNG = Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="), (c) => c.charCodeAt(0));

describe.skipIf(!up)("live API phase 2", () => {
  it("page delete / duplicate / insert-blank, version upload, restore", async () => {
    const { api, ref } = await fresh();
    let v = await api.duplicatePages(ref, [1]); expect(v.version).toBe(2);
    v = await api.insertBlank(r(v), 0); expect(v.version).toBe(3);
    v = await api.deletePages(r(v), [1, 2]); expect(v.version).toBe(4);
    expect((await api.getMetadata(ref.document_id, 4)).page_count).toBe(3);
    await expect(api.deletePages(ref, [1])).rejects.toBeInstanceOf(VersionConflictError);
    const pdf = await PDFDocument.load(fixture); pdf.removePage(2);
    v = await api.uploadVersion(r(v), await pdf.save(), "p2.pdf"); expect(v.version).toBe(5);
    expect((await api.getMetadata(ref.document_id, 5)).page_count).toBe(2);
    v = await api.restoreVersion(r(v), ref.version_id); expect(v.version).toBe(6);
    expect((await api.getMetadata(ref.document_id, 6)).page_count).toBe(3);
  });
  it("annotations with reply + resolve, forms add/fill/flatten", async () => {
    const { api, ref } = await fresh();
    let v = await api.changeAnnotations(ref, { add: [{ page: 1, type: "square", rect: [50, 50, 150, 100], color: [1, 0, 0], contents: "Check" } as never] });
    const id = (v.report as { ids: string[] }).ids[0];
    v = await api.changeAnnotations(r(v), { add: [{ page: 1, type: "text", rect: [50, 50, 70, 70], contents: "ok", in_reply_to: id } as never], update: [{ id, state: "resolved" }] });
    const a = await api.listAnnotations(ref.document_id, v.version);
    expect(a.annotations.find((x) => x.id === id)?.state).toBe("resolved");
    expect(a.annotations.some((x) => x.in_reply_to === id)).toBe(true);
    v = await api.addFormFields(r(v), [{ name: "full_name", type: "text", page: 1, rect: [72, 600, 300, 622], required: true }]);
    v = await api.fillForm(r(v), { full_name: "Ada Lovelace" });
    expect((await api.listForms(ref.document_id, v.version)).fields[0].value).toBe("Ada Lovelace");
    v = await api.flattenForm(r(v));
    expect((await api.listForms(ref.document_id, v.version)).fields).toHaveLength(0);
  });
  it("signature asset + placement, request → signer complete → final version, audit", async () => {
    const { api, ref } = await fresh();
    const svg = new FormData(); svg.append("file", new Blob(["<svg xmlns='http://www.w3.org/2000/svg'/>"], { type: "image/svg+xml" }), "s.svg");
    const rej = await fetch(BASE + "/signatures/assets", { method: "POST", body: svg, headers: { Authorization: `Bearer ${api.getTokens()!.access_token}` } });
    expect(rej.status).toBe(415);
    const asset = await api.uploadSignaturePng(new Blob([PNG], { type: "image/png" }));
    let v = await api.placeSignatures(ref, [{ asset_id: asset.asset_id, page: 1, rect: [72, 72, 200, 112] }]);
    expect((v.report as { visual_only: boolean }).visual_only).toBe(true);
    const req = await api.createSignatureRequest({ document_id: ref.document_id, version: v.version, message: "", title: "T",
      signers: [{ name: "Signer One", email: "signer.one@example.com" }], fields: [{ signer_index: 0, page: 1, rect: [300, 72, 450, 112], type: "signature" }, { signer_index: 0, page: 1, rect: [460, 72, 560, 92], type: "date" }] });
    const link = req.signer_links[0];
    expect(link.path).toBe(`/sign/${link.token}`);
    const pub = new HttpEditorApi({ baseUrl: BASE });
    const sess = await pub.getSignSession(link.token);
    expect(sess.can_sign).toBe(true);
    const sigField = sess.fields.find((f) => f.type === "signature")!;
    const done = await pub.completeSigning(link.token, [{ field_id: sigField.field_id, text: "Signer One", font: "Times-Italic" }]);
    expect(done.status).toBe("completed");
    expect(done.final_version_id).toBeTruthy();
    const d = await api.getDocument(ref.document_id);
    expect(d.version_id).toBe(done.final_version_id);
    const ver = await api.verifySignatures(ref.document_id);
    expect(ver.signatures.length).toBeGreaterThan(0);
    expect(ver.signatures[0].trusted).toBe(false);
    await expect(api.rotatePages({ document_id: d.document_id, version_id: d.version_id, version: d.current_version }, [1], 90)).rejects.toBeInstanceOf(DocumentSignedError);
    const audit = await api.documentAudit(ref.document_id);
    expect(audit.map((x) => x.action)).toEqual(expect.arrayContaining(["upload", "sign", "request_sent", "completed"]));
  });
  it("doc management: list shape, star, tags, folder, share link (view-only), trash/restore/permanent delete", async () => {
    const { api, ref } = await fresh(`mgmt-${Date.now()}.pdf`);
    const id = ref.document_id;
    const f = await api.createFolder(`F${Date.now()}`);
    await api.patchDocument(id, { starred: true, tags: ["tax", "q1"], folder_id: f.folder_id });
    expect((await api.listDocuments({ starred: true, limit: 200 })).items.some((x) => x.document_id === id)).toBe(true);
    expect((await api.listDocuments({ folder_id: f.folder_id })).items.map((x) => x.document_id)).toEqual([id]);
    expect((await api.listDocuments({ tag: "tax", limit: 200 })).items.some((x) => x.document_id === id)).toBe(true);
    const sh = await api.createShare(id, { email: null, role: "viewer" });
    expect(sh.url).toMatch(/^\/shared\//);
    const info = await new HttpEditorApi({ baseUrl: BASE }).sharedInfo(sh.url!.split("/").pop()!);
    expect(info.page_count).toBe(3);
    await expect(api.createShare(id, { email: null, role: "editor" })).rejects.toMatchObject({ code: "LINK_EDITOR_NOT_SUPPORTED" });
    await api.trashDocument(id);
    expect((await api.listDocuments({ trashed: true, limit: 200 })).items.some((x) => x.document_id === id)).toBe(true);
    await api.restoreDocument(id); await api.trashDocument(id);
    await api.deletePermanently(id);
    await expect(api.getDocument(id)).rejects.toBeTruthy();
    await api.deleteFolder(f.folder_id);
  });
  it("AI stub returns quoted excerpts with page refs", async () => {
    const { api, ref } = await fresh();
    const a = await api.aiSummarize(ref.document_id, "short");
    expect(a.model).toContain("stub");
    expect(a.external_processing).toBe(false);
    expect(a.citations.every((c) => c.page >= 1 && c.page <= 3)).toBe(true);
  });
  it("refresh uses the cookie (raw check: login Set-Cookie thynkpdf_rt, refresh without body)", async () => {
    const res = await fetch(BASE + "/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: "dev@thynkpdf.dev", password: "ThynkDev-2026!" }) });
    const ck = res.headers.get("set-cookie") ?? "";
    expect(ck).toMatch(/thynkpdf_rt=.*HttpOnly/i);
    const rt = ck.split(";")[0];
    const r1 = await fetch(BASE + "/auth/refresh", { method: "POST", headers: { cookie: rt } });
    expect(r1.status).toBe(200);
    const again = await fetch(BASE + "/auth/refresh", { method: "POST", headers: { cookie: rt } });
    expect(again.status).toBe(401); // single-use
  });
});
