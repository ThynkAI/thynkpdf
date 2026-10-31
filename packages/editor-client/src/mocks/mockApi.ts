/**
 * MOCK LAYER — in-memory stand-in for the THYNKPDF backend, matching docs/openapi.json shapes.
 * Used only when NEXT_PUBLIC_API_MOCK=1 or in unit tests. Not a backend integration.
 */
import { PDFDocument, degrees as pdfDegrees } from "pdf-lib";
import type { EditorApi, DocumentRef, RotateAngle } from "../types";
import { VersionConflictError } from "../http";

let seq = 0;
const id = (p: string) => `${p}_${(++seq).toString(36)}`;
interface Doc { filename: string; versions: { id: string; bytes: Uint8Array }[] }

export class MockEditorApi implements EditorApi {
  readonly kind = "mock" as const;
  readonly docs = new Map<string, Doc>();
  async health() { return true; }
  async login() { return { access_token: "mock-access", refresh_token: "mock-refresh", token_type: "bearer", expires_in: 900 }; }
  async refresh() { return this.login(); }
  async upload(file: Blob, filename: string) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const pdf = await PDFDocument.load(bytes);
    const document_id = id("doc"), version_id = id("ver");
    this.docs.set(document_id, { filename, versions: [{ id: version_id, bytes }] });
    return { document_id, version_id, version: 1, sha256: "", size: bytes.length, page_count: pdf.getPageCount() };
  }
  private doc(docId: string) { const d = this.docs.get(docId); if (!d) throw new Error("DOCUMENT_NOT_FOUND"); return d; }
  async getDocument(docId: string) {
    const d = this.doc(docId), v = d.versions.length;
    return { document_id: docId, filename: d.filename, current_version: v, version_id: d.versions[v - 1].id, created_at: new Date(0).toISOString() };
  }
  async fileSource(ref: Pick<DocumentRef, "document_id" | "version_id">) {
    const v = this.doc(ref.document_id).versions.find((x) => x.id === ref.version_id);
    if (!v) throw new Error("VERSION_NOT_FOUND");
    return { data: v.bytes.slice() };
  }
  async rotatePages(ref: DocumentRef, pages: number[], angle: RotateAngle) {
    const d = this.doc(ref.document_id);
    if (ref.version !== d.versions.length) throw new VersionConflictError(409, "VERSION_CONFLICT", "stale version", { current_version: d.versions.length });
    const pdf = await PDFDocument.load(d.versions[d.versions.length - 1].bytes);
    for (const n of pages) { const p = pdf.getPage(n - 1); p.setRotation(pdfDegrees((p.getRotation().angle + angle + 360) % 360)); }
    const bytes = await pdf.save(), version_id = id("ver");
    d.versions.push({ id: version_id, bytes });
    return { document_id: ref.document_id, version_id, version: d.versions.length, sha256: "", size: bytes.length, report: {} };
  }
}
