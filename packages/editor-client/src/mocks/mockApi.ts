/**
 * MOCK LAYER — in-memory stand-in for the THYNKPDF backend, matching the agreed shapes.
 * Used only when NEXT_PUBLIC_API_MOCK=1 or in tests. Not a backend integration.
 */
import { PDFDocument, degrees as pdfDegrees } from "pdf-lib";
import type { EditorApi, DocumentRef } from "../types";

let seq = 0;
const id = (p: string) => `${p}_${(++seq).toString(36)}`;

export class MockEditorApi implements EditorApi {
  readonly kind = "mock" as const;
  readonly store = new Map<string, Map<string, Uint8Array>>();
  async health() { return true; }
  async login(_u: string, _p: string) {
    return { access_token: "mock-access", refresh_token: "mock-refresh", token_type: "bearer", expires_in: 3600 };
  }
  async refresh() { return this.login("", ""); }
  async upload(file: Blob, _filename: string) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    await PDFDocument.load(bytes); // validate like a backend would
    const document_id = id("doc"), version_id = id("ver");
    this.store.set(document_id, new Map([[version_id, bytes]]));
    return { document_id, version_id };
  }
  private get(ref: DocumentRef) {
    const b = this.store.get(ref.document_id)?.get(ref.version_id);
    if (!b) throw new Error("404 version not found");
    return b;
  }
  async fileSource(ref: DocumentRef) { return { data: this.get(ref).slice() }; }
  async rotatePages(ref: DocumentRef, pages: number[], deg: 90 | 180 | 270) {
    const doc = await PDFDocument.load(this.get(ref));
    for (const i of pages) {
      const p = doc.getPage(i);
      p.setRotation(pdfDegrees((p.getRotation().angle + deg) % 360));
    }
    const version_id = id("ver");
    this.store.get(ref.document_id)!.set(version_id, await doc.save());
    return { document_id: ref.document_id, version_id };
  }
}
