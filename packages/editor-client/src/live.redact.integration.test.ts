// @vitest-environment node
/** Live contract test for redaction (search → images → apply as a new file). Skipped if the API is down. */
import { PDFDocument, StandardFonts } from "pdf-lib";
import { HttpEditorApi } from "./http";

const BASE = process.env.THYNKPDF_API_URL ?? "http://localhost:8000";
const up = await fetch(BASE + "/health").then((r) => r.ok, () => false);
const PNG = Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="), (c) => c.charCodeAt(0));

describe.skipIf(!up)("live API redaction", () => {
  it("finds text + patterns, lists images, applies to a new document; original unchanged", async () => {
    const d = await PDFDocument.create(); const f = await d.embedFont(StandardFonts.Helvetica); const p = d.addPage([612, 792]);
    p.drawText("Call (519) 555-0142 or mail jane.doe@example.com", { x: 72, y: 700, size: 12, font: f });
    p.drawText("Keep this line", { x: 72, y: 650, size: 12, font: f });
    p.drawImage(await d.embedPng(PNG), { x: 300, y: 300, width: 100, height: 100 });
    const api = new HttpEditorApi({ baseUrl: BASE });
    api.setTokens(await api.localSession("live-test-browser-key-0123456789abcdef"));
    const u = await api.upload(new Blob([await d.save()], { type: "application/pdf" }), "redact-live.pdf");
    const s = await api.redactSearch(u.document_id, { patterns: ["email", "phone"] });
    expect(s.matches.map((m) => m.kind).sort()).toEqual(["email", "phone"]);
    const im = await api.redactImages(u.document_id);
    expect(im.images).toHaveLength(1); expect(im.images[0].rect.map(Math.round)).toEqual([300, 300, 400, 400]);
    const marks = [...s.matches.flatMap((m) => m.rects.map((rect) => ({ page: m.page, rect }))), { page: 1, rect: im.images[0].rect }];
    const v = await api.redactApply({ document_id: u.document_id, version_id: u.version_id, version: u.version }, { marks, fill: "black", sanitize: {}, output: "new_document", filename: "redact-live-redacted.pdf" });
    expect(v.document_id).not.toBe(u.document_id);
    const after = await api.redactSearch(v.document_id, { patterns: ["email", "phone"], query: "Keep this line" });
    expect(after.matches.map((m) => m.text)).toEqual(["Keep this line"]);
    expect((await api.redactSearch(u.document_id, { patterns: ["email"] })).matches).toHaveLength(1);
  });
});
