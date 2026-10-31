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
    await api.login(process.env.THYNKPDF_DEV_EMAIL ?? "dev@thynkpdf.dev", process.env.THYNKPDF_DEV_PASSWORD ?? "ThynkDev-2026!");
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
  });
});
