/**
 * MOCK LAYER — in-memory stand-in for the THYNKPDF backend, matching docs/openapi.json shapes.
 * Used only when NEXT_PUBLIC_API_MOCK=1 or in unit tests. Not a backend integration.
 */
import { PDFDocument, degrees as pdfDegrees } from "pdf-lib";
import type { EditOp, PdfMetadata, VersionInfo, UploadResponse, Capabilities, EditorApi, DocumentRef, RotateAngle, TokenResponse } from "../types";
import { ApiError, VersionConflictError } from "../http";

let seq = 0;
const id = (p: string) => `${p}_${(++seq).toString(36)}`;
interface Doc { filename: string; versions: { id: string; bytes: Uint8Array }[] }

export class MockEditorApi implements EditorApi {
  readonly kind = "mock" as const;
  readonly docs = new Map<string, Doc>();
  private tokens: TokenResponse | null = null;
  onTokensChanged?: (t: TokenResponse | null) => void;
  getTokens() { return this.tokens; }
  setTokens(t: TokenResponse | null) { this.tokens = t; this.onTokensChanged?.(t); }
  async health() { return true; }
  async login() { this.setTokens(this.tok()); return this.tokens!; }
  private tok(): TokenResponse { return { access_token: "mock-access", refresh_token: "mock-refresh", token_type: "bearer", expires_in: 900 }; }
  async refresh() { return this.login(); }
  async upload(file: Blob, filename: string) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const pdf = await PDFDocument.load(bytes);
    const document_id = id("doc"), version_id = id("ver");
    this.docs.set(document_id, { filename, versions: [{ id: version_id, bytes }] });
    return { document_id, version_id, version: 1, filename, sha256: "", size: bytes.length, page_count: pdf.getPageCount() };
  }
  private bump(ref: DocumentRef, mutate: (pdf: PDFDocument) => PDFDocument | void | Promise<PDFDocument | void>) {
    return (async () => {
      const d = this.doc(ref.document_id);
      if (ref.version !== d.versions.length) throw new VersionConflictError(409, "VERSION_CONFLICT", "stale version", { current_version: d.versions.length });
      const src = await PDFDocument.load(d.versions[d.versions.length - 1].bytes);
      const out = (await mutate(src)) ?? src;
      const bytes = await out.save(), version_id = id("ver");
      d.versions.push({ id: version_id, bytes });
      return { document_id: ref.document_id, version_id, version: d.versions.length, filename: d.filename, sha256: "", size: bytes.length, report: {} };
    })();
  }
  reorderPages(ref: DocumentRef, order: number[]) {
    return this.bump(ref, async (src) => {
      const out = await PDFDocument.create();
      (await out.copyPages(src, order.map((n) => n - 1))).forEach((p) => out.addPage(p));
      return out;
    });
  }
  async getCapabilities(docId: string): Promise<Capabilities> {
    const d = await this.getDocument(docId);
    const n = (await PDFDocument.load(this.doc(docId).versions[d.current_version - 1].bytes)).getPageCount();
    return { document_id: docId, version: d.current_version, version_id: d.version_id,
      page_ops: { rotate: true, reorder: true, extract: true, split: true, merge: true, delete: false, duplicate: false, insert_blank: false }, compress: true, text_replace: false,
      edit_ops: { text_replace: false, text_delete: false, text_move: false, text_insert: false }, annotations: false, forms: false,
      document_limitations: [], pages: Array.from({ length: n }, (_, i) => ({ number: i + 1, text_replace: false, text_delete: false, text_move: false, text_insert: false, editable_fonts: [], limitations: [] })), safe_alternatives: [] };
  }
  private doc(docId: string) { const d = this.docs.get(docId); if (!d) throw new Error("DOCUMENT_NOT_FOUND"); return d; }
  async getDocument(docId: string) {
    const d = this.doc(docId), v = d.versions.length;
    return { document_id: docId, filename: d.filename, current_version: v, version_id: d.versions[v - 1].id, created_at: new Date(0).toISOString(), starred: false, tags: [] as string[], visibility: "org" };
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
    return { document_id: ref.document_id, version_id, version: d.versions.length, filename: d.filename, sha256: "", size: bytes.length, report: {} };
  }
  private latest(docId: string) { const d = this.doc(docId); return d.versions[d.versions.length - 1].bytes; }
  private async newDoc(pdf: PDFDocument, filename: string): Promise<UploadResponse> {
    const bytes = await pdf.save();
    return this.upload(new Blob([bytes as BlobPart]), filename);
  }
  private async pick(docId: string, pages: number[]) {
    const src = await PDFDocument.load(this.latest(docId)); const out = await PDFDocument.create();
    (await out.copyPages(src, pages.map((n) => n - 1))).forEach((p) => out.addPage(p)); return out;
  }
  async getMetadata(docId: string): Promise<PdfMetadata> {
    const d = await this.getDocument(docId); const pdf = await PDFDocument.load(this.latest(docId));
    return { document_id: docId, version: d.current_version, version_id: d.version_id, page_count: pdf.getPageCount(), has_acroform: false, form_field_count: 0, has_signatures: false, attachments: [], has_javascript: false, has_outlines: false, info: {}, is_encrypted: false, is_linearized: false, pdf_version: "1.7",
      pages: pdf.getPages().map((p, i) => ({ number: i + 1, width: p.getWidth(), height: p.getHeight(), rotation: p.getRotation().angle, annotations: 0, fonts: [], images: 0 })) };
  }
  async editText(_ref: DocumentRef, _ops: EditOp[]): Promise<never> {
    throw new ApiError(422, "EDIT_NOT_SUPPORTED", "Text editing is not available in the mock backend");
  }
  async extractPages(docId: string, pages: number[], filename?: string) { return this.newDoc(await this.pick(docId, pages), filename ?? `extract-${this.doc(docId).filename}`); }
  async splitDocument(docId: string, ranges: [number, number][]) {
    const out: UploadResponse[] = [];
    for (const [i, [a, b]] of ranges.entries()) out.push(await this.newDoc(await this.pick(docId, Array.from({ length: b - a + 1 }, (_, k) => a + k)), `part${i + 1}-${this.doc(docId).filename}`));
    return out;
  }
  async mergeDocuments(ids: string[], filename = "merged.pdf") {
    const out = await PDFDocument.create();
    for (const id of ids) { const src = await PDFDocument.load(this.latest(id)); (await out.copyPages(src, src.getPageIndices())).forEach((p) => out.addPage(p)); }
    return this.newDoc(out, filename);
  }
  async listDocuments() { return { items: await Promise.all([...this.docs.keys()].map((k) => this.getDocument(k))), next_cursor: null }; }
  async listVersions(docId: string): Promise<VersionInfo[]> {
    return this.doc(docId).versions.map((v, i, a) => ({ version_id: v.id, number: i + 1, sha256: "", size: v.bytes.length, operation: i ? "edit" : "upload", parent_version_id: i ? a[i - 1].id : null, created_at: new Date(0).toISOString() }));
  }
}
