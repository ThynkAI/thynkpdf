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
export type DocumentPage = S["DocumentPage"];
export interface ListQuery { q?: string; folder_id?: string; tag?: string; starred?: boolean; trashed?: boolean; sort?: "updated_at" | "name" | "created_at"; order?: "asc" | "desc"; limit?: number; cursor?: string }
export type DocPatch = S["DocPatch"];
export type Folder = S["FolderOut"];
export type Share = S["ShareOut"];
export type ShareIn = S["ShareIn"];
export type Annotation = S["Annotation"];
export type AnnotationIn = S["AnnotationIn"];
export type AnnotationsOut = S["AnnotationsOut"];
export type FormField = S["FormField"];
export type FormsOut = S["FormsOut"];
export type FieldSpec = S["FieldSpec"];
export type SignatureAsset = S["AssetOut"];
export type Placement = S["Placement"];
export type CreateSignatureRequest = S["CreateReqIn"];
export type CreatedSignatureRequest = S["CreatedReqOut"];
export type SignerLink = S["SignerLink"];
export type SignatureRequest = S["ReqOut"];
export type SignatureEvents = S["EventsOut"];
export type SignSession = S["SignSessionOut"];
export type SignerPlacement = S["SignerPlacement"];
export type AuditEntry = S["DocAuditOut"];
export type AiAnswer = S["AIOut"];
export type SigStatus = S["SigStatus"];
export type VerifyOut = S["VerifyOut"];
export type PdfMetadata = S["MetadataOut"];
export type Limitation = S["Limitation"];
export type Capabilities = S["CapabilitiesOut"];
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
  listDocuments(q?: ListQuery): Promise<DocumentPage>;
  listVersions(documentId: string): Promise<VersionInfo[]>;
  /** Session persistence hooks. */
  getTokens(): TokenResponse | null;
  setTokens(t: TokenResponse | null): void;
  onTokensChanged?: (t: TokenResponse | null) => void;
}
