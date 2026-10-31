// Agreed backend shapes (docs/openapi.json not yet published by backend; see README).
export interface TokenResponse { access_token: string; refresh_token: string; token_type: string; expires_in: number }
export interface UploadResponse { document_id: string; version_id: string }
/** Page ops are synchronous and return the new version. Exact route is ASSUMED until openapi.json exists. */
export interface PageOpResponse { document_id: string; version_id: string }
export interface DocumentRef { document_id: string; version_id: string }

export interface EditorApi {
  readonly kind: "http" | "mock";
  health(): Promise<boolean>;
  login(username: string, password: string): Promise<TokenResponse>;
  refresh(): Promise<TokenResponse>;
  upload(file: Blob, filename: string): Promise<UploadResponse>;
  /** Source for PDF.js: URL + headers (Range handled by PDF.js) or raw bytes for mock. */
  fileSource(ref: DocumentRef): Promise<{ url: string; httpHeaders?: Record<string, string> } | { data: Uint8Array }>;
  rotatePages(ref: DocumentRef, pages: number[], degrees: 90 | 180 | 270): Promise<PageOpResponse>;
}
