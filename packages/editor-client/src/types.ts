// Types generated from docs/openapi.json (pnpm --filter @thynkpdf/editor-client gen).
import type { components } from "./generated/schema";
type S = components["schemas"];
export type TokenResponse = S["TokenOut"];
export type UploadResponse = S["UploadOut"];
export type VersionResult = S["VersionResult"];
export type DocumentInfo = S["DocumentOut"];
export type RotateRequest = S["RotateIn"];
export type RotateAngle = RotateRequest["angle"];
export type ReorderRequest = S["ReorderIn"];
export type EditOp = S["EditOp"];
export type VersionInfo = S["VersionOut"];
/** HAND-WRITTEN subset of GET /pdf/{id}/metadata (no response schema in openapi.json). */
export interface PdfMetadata {
  document_id: string; version: number; version_id: string; page_count: number;
  has_acroform: boolean; form_field_count: number; has_signatures: boolean;
  pages: { number: number; width: number; height: number; rotation: number; annotations: number }[];
}

/** HAND-WRITTEN: /pdf/{id}/capabilities has no response schema in openapi.json yet (backend ask). Mirrors docs/integration-for-bot1.md. */
export interface Limitation { code: string; message: string; font?: string }
export interface Capabilities {
  document_id: string; version: number; version_id: string;
  page_ops: { rotate: boolean; reorder: boolean; extract: boolean; split: boolean; merge: boolean };
  compress: boolean; text_replace: boolean;
  document_limitations: Limitation[];
  pages: { number: number; text_replace: boolean; editable_fonts: string[]; limitations: Limitation[] }[];
  safe_alternatives: string[];
}
/** What the editor holds about the open server document. `version` is used as expected_version. */
export interface DocumentRef { document_id: string; version_id: string; version: number }

export interface EditorApi {
  readonly kind: "http" | "mock";
  health(): Promise<boolean>;
  login(email: string, password: string): Promise<TokenResponse>;
  refresh(): Promise<TokenResponse>;
  upload(file: Blob, filename: string): Promise<UploadResponse>;
  getDocument(documentId: string): Promise<DocumentInfo>;
  /** Source for PDF.js: URL + auth header (PDF.js uses Range) or raw bytes for mock. */
  fileSource(ref: Pick<DocumentRef, "document_id" | "version_id">): Promise<{ url: string; httpHeaders?: Record<string, string> } | { data: Uint8Array }>;
  /** pages are 1-based. Throws VersionConflictError on stale expected_version. */
  rotatePages(ref: DocumentRef, pages: number[], angle: RotateAngle): Promise<VersionResult>;
  /** order: 1-based permutation of page numbers. */
  reorderPages(ref: DocumentRef, order: number[]): Promise<VersionResult>;
  getCapabilities(documentId: string): Promise<Capabilities>;
  getMetadata(documentId: string, version?: number): Promise<PdfMetadata>;
  editText(ref: DocumentRef, operations: EditOp[], revisionNote?: string): Promise<VersionResult>;
  /** Creates NEW documents (backend semantics). pages / ranges are 1-based. */
  extractPages(documentId: string, pages: number[], filename?: string): Promise<UploadResponse>;
  splitDocument(documentId: string, ranges: [number, number][]): Promise<UploadResponse[]>;
  mergeDocuments(documentIds: string[], filename?: string): Promise<UploadResponse>;
  listDocuments(): Promise<DocumentInfo[]>;
  listVersions(documentId: string): Promise<VersionInfo[]>;
  /** Session persistence hooks. */
  getTokens(): TokenResponse | null;
  setTokens(t: TokenResponse | null): void;
  onTokensChanged?: (t: TokenResponse | null) => void;
}
