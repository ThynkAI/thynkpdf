import type { ListQuery, DocumentPage, DocPatch, Folder, Share, ShareIn, AnnotationIn, AnnotationsOut, FormsOut, FieldSpec, SignatureAsset, Placement, CreateSignatureRequest, CreatedSignatureRequest, SignatureRequest, SignatureEvents, SignSession, SignerPlacement, AuditEntry, AiAnswer, VerifyOut, Capabilities, EditOp, PdfMetadata, VersionInfo, EditorApi, TokenResponse, UploadResponse, DocumentRef, VersionResult, DocumentInfo, RotateRequest, RotateAngle } from "./types";

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public details?: Record<string, unknown>) { super(message); }
}
export class VersionConflictError extends ApiError {
  get currentVersion() { return (this.details?.current_version as number | undefined) ?? null; }
}
/** 409 DOCUMENT_SIGNED: the version carries a digital signature; in-place edits would invalidate it. Not a version conflict. */
export class DocumentSignedError extends ApiError {}
/** 429 RATE_LIMITED: retryAfter in seconds. */
export class RateLimitedError extends ApiError {
  get retryAfter() { return Number(this.details?.retry_after ?? 0) || null; }
}

export interface HttpApiOptions { baseUrl: string; fetchImpl?: typeof fetch }

export class HttpEditorApi implements EditorApi {
  readonly kind = "http" as const;
  private tokens: TokenResponse | null = null;
  private f: typeof fetch;
  constructor(private opts: HttpApiOptions) { this.f = opts.fetchImpl ?? ((...a) => fetch(...a)); }

  onTokensChanged?: (t: TokenResponse | null) => void;
  get isAuthenticated() { return !!this.tokens; }
  getTokens() { return this.tokens; }
  setTokens(t: TokenResponse | null) { this.tokens = t; this.onTokensChanged?.(t); }
  private url(p: string) { return this.opts.baseUrl.replace(/\/$/, "") + p; }
  private authHeaders(): Record<string, string> {
    return this.tokens ? { Authorization: `Bearer ${this.tokens.access_token}` } : {};
  }
  /** Raw authenticated fetch with one cookie-refresh retry on 401. credentials:"include" so the httpOnly thynkpdf_rt cookie flows. */
  async raw(path: string, init: RequestInit = {}, retry = true): Promise<Response> {
    const res = await this.f(this.url(path), { credentials: "include", ...init, headers: { ...this.authHeaders(), ...(init.headers as Record<string, string> | undefined) } });
    if (res.status === 401 && retry && !path.startsWith("/auth/") && this.tokens) {
      await this.refresh();
      return this.raw(path, init, false);
    }
    return res;
  }
  private async req<T>(path: string, init: RequestInit = {}, retry = true): Promise<T> {
    const res = await this.raw(path, init, retry);
    if (!res.ok) {
      let body: { error?: { code?: string; message?: string; details?: Record<string, unknown> } } = {};
      try { body = await res.json(); } catch { /* non-JSON */ }
      const e = body.error ?? {};
      const Cls = res.status === 409 && e.code === "VERSION_CONFLICT" ? VersionConflictError
        : res.status === 409 && e.code === "DOCUMENT_SIGNED" ? DocumentSignedError
        : res.status === 429 ? RateLimitedError : ApiError;
      throw new Cls(res.status, e.code ?? "HTTP_" + res.status, e.message ?? `${init.method ?? "GET"} ${path} failed: ${res.status}`, e.details);
    }
    if (res.status === 204) return undefined as T;
    return (await res.json()) as T;
  }
  private json(body: unknown): RequestInit { return { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }; }

  async health() {
    try { return (await this.f(this.url("/health"))).ok; } catch { return false; }
  }
  async login(email: string, password: string) {
    this.setTokens(this.strip(await this.req<TokenResponse>("/auth/login", this.json({ email, password }), false)));
    return this.tokens!;
  }
  private inflight: Promise<TokenResponse> | null = null;
  /**
   * Refresh via the httpOnly thynkpdf_rt cookie (no body). Refresh tokens are single-use server-side, so concurrent
   * callers share ONE in-flight request; a second parallel refresh would revoke the session (TOKEN_REVOKED).
   */
  refresh(): Promise<TokenResponse> {
    if (!this.inflight) {
      this.inflight = this.req<TokenResponse>("/auth/refresh", { method: "POST" }, false)
        .then((t) => { this.setTokens(this.strip(t)); return this.tokens!; })
        .catch((e) => { this.setTokens(null); throw e; })
        .finally(() => { this.inflight = null; });
    }
    return this.inflight;
  }
  /** The JSON refresh_token is ignored by the web app (cookie only); never keep it in JS memory. */
  private strip(t: TokenResponse): TokenResponse { return { ...t, refresh_token: "" }; }
  async logout() {
    try { await this.f(this.url("/auth/logout"), { method: "POST", credentials: "include" }); } catch { /* offline */ }
    this.setTokens(null);
  }
  async upload(file: Blob, filename: string) {
    const fd = new FormData();
    fd.append("file", file, filename);
    return this.req<UploadResponse>("/documents/upload", { method: "POST", body: fd });
  }
  getDocument(id: string) { return this.req<DocumentInfo>(`/documents/${encodeURIComponent(id)}`); }
  async fileSource(ref: Pick<DocumentRef, "document_id" | "version_id">) {
    return { url: this.url(`/documents/${ref.document_id}/versions/${ref.version_id}/file`), httpHeaders: this.authHeaders() };
  }
  rotatePages(ref: DocumentRef, pages: number[], angle: RotateAngle) {
    const body: RotateRequest = { document_id: ref.document_id, expected_version: ref.version, pages, angle };
    return this.req<VersionResult>("/pdf/pages/rotate", this.json(body));
  }
  reorderPages(ref: DocumentRef, order: number[]) {
    return this.req<VersionResult>("/pdf/pages/reorder", this.json({ document_id: ref.document_id, expected_version: ref.version, order }));
  }
  getCapabilities(id: string) { return this.req<Capabilities>(`/pdf/${encodeURIComponent(id)}/capabilities`); }
  getMetadata(id: string, version?: number) {
    return this.req<PdfMetadata>(`/pdf/${encodeURIComponent(id)}/metadata${version ? `?version=${version}` : ""}`);
  }
  editText(ref: DocumentRef, operations: EditOp[], revision_note?: string) {
    return this.req<VersionResult>("/pdf/edit", this.json({ document_id: ref.document_id, expected_version: ref.version, operations, revision_note }));
  }
  extractPages(document_id: string, pages: number[], filename?: string) { return this.req<UploadResponse>("/pdf/pages/extract", this.json({ document_id, pages, filename })); }
  splitDocument(document_id: string, ranges: [number, number][]) { return this.req<UploadResponse[]>("/pdf/split", this.json({ document_id, ranges })); }
  mergeDocuments(document_ids: string[], filename?: string) { return this.req<UploadResponse>("/pdf/merge", this.json({ document_ids, ...(filename ? { filename } : {}) })); }
  listDocuments(q: ListQuery = {}) {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(q)) if (v !== undefined && v !== null && v !== "") p.set(k, String(v));
    const qs = p.toString();
    return this.req<DocumentPage>(`/documents${qs ? "?" + qs : ""}`);
  }
  listVersions(id: string) { return this.req<VersionInfo[]>(`/documents/${encodeURIComponent(id)}/versions`); }

  // ---- Phase 2 server features (HTTP only; the mock API does not implement these) ----
  private e(id: string) { return encodeURIComponent(id); }
  private v(ref: DocumentRef) { return { document_id: ref.document_id, expected_version: ref.version }; }
  private send<T>(method: string, path: string, body?: unknown) {
    return this.req<T>(path, body === undefined ? { method } : { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  }
  deletePages(ref: DocumentRef, pages: number[]) { return this.send<VersionResult>("POST", "/pdf/pages/delete", { ...this.v(ref), pages }); }
  duplicatePages(ref: DocumentRef, pages: number[], position: "after_each" | number = "after_each") { return this.send<VersionResult>("POST", "/pdf/pages/duplicate", { ...this.v(ref), pages, position }); }
  insertBlank(ref: DocumentRef, after_page: number, count = 1) { return this.send<VersionResult>("POST", "/pdf/pages/insert-blank", { ...this.v(ref), after_page, count }); }
  insertFrom(ref: DocumentRef, source_document_id: string, after_page: number, source_pages?: number[]) { return this.send<VersionResult>("POST", "/pdf/pages/insert-from", { ...this.v(ref), source_document_id, after_page, ...(source_pages ? { source_pages } : {}) }); }
  /** Save client-modified bytes as a NEW VERSION of the same document (POST /documents/{id}/versions). */
  uploadVersion(ref: DocumentRef, bytes: Uint8Array, filename: string) {
    const fd = new FormData();
    fd.append("file", new Blob([bytes as BlobPart], { type: "application/pdf" }), filename);
    fd.append("expected_version", String(ref.version));
    return this.req<VersionResult>(`/documents/${this.e(ref.document_id)}/versions`, { method: "POST", body: fd });
  }
  compress(ref: DocumentRef, preset: "low" | "balanced" | "high" = "balanced") { return this.send<VersionResult>("POST", "/pdf/compress", { ...this.v(ref), preset, strip_metadata: false }); }
  restoreVersion(ref: DocumentRef, versionId: string) { return this.send<VersionResult>("POST", `/documents/${this.e(ref.document_id)}/versions/${this.e(versionId)}/restore`, { expected_version: ref.version }); }
  // annotations
  listAnnotations(id: string, version?: number) { return this.req<AnnotationsOut>(`/pdf/${this.e(id)}/annotations${version ? `?version=${version}` : ""}`); }
  changeAnnotations(ref: DocumentRef, ch: { add?: AnnotationIn[]; update?: Record<string, unknown>[]; delete?: string[] }) { return this.send<VersionResult>("POST", "/pdf/annotations", { ...this.v(ref), ...ch }); }
  // forms
  listForms(id: string, version?: number) { return this.req<FormsOut>(`/pdf/${this.e(id)}/forms${version ? `?version=${version}` : ""}`); }
  addFormFields(ref: DocumentRef, add: FieldSpec[], del?: string[]) { return this.send<VersionResult>("POST", "/pdf/forms/fields", { ...this.v(ref), add, ...(del ? { delete: del } : {}) }); }
  fillForm(ref: DocumentRef, values: Record<string, string | boolean | string[]>, flatten = false) { return this.send<VersionResult>("POST", "/pdf/forms/fill", { ...this.v(ref), values, flatten }); }
  flattenForm(ref: DocumentRef) { return this.send<VersionResult>("POST", "/pdf/forms/flatten", { ...this.v(ref), confirm: true }); }
  /** PROVISIONAL (backend THYNKPDF2, branch feat/xfa): convert an XFA form to a standard AcroForm as a new version.
   * Path is a placeholder until the backend publishes it; callers must tolerate 404/405 (not deployed) and
   * 422 `xfa_dynamic_unsupported` (dynamic XFA with no widgets). */
  convertXfaToAcroForm(ref: DocumentRef) { return this.send<VersionResult>("POST", "/pdf/forms/xfa/convert", { ...this.v(ref) }); }
  // signatures
  listSignatureAssets() { return this.req<SignatureAsset[]>("/signatures/assets"); }
  uploadSignaturePng(png: Blob) { const fd = new FormData(); fd.append("file", png, "signature.png"); return this.req<SignatureAsset>("/signatures/assets", { method: "POST", body: fd }); }
  createTypedSignature(text: string, font = "Times-Italic") { return this.send<SignatureAsset>("POST", "/signatures/assets", { kind: "typed", text, font }); }
  deleteSignatureAsset(id: string) { return this.send<void>("DELETE", `/signatures/assets/${this.e(id)}`); }
  async signatureAssetImage(id: string) { const r = await this.raw(`/signatures/assets/${this.e(id)}/image`); if (!r.ok) throw new ApiError(r.status, "HTTP_" + r.status, "image failed"); return r.blob(); }
  placeSignatures(ref: DocumentRef, placements: Placement[]) { return this.send<VersionResult>("POST", "/pdf/signatures/place", { ...this.v(ref), placements }); }
  verifySignatures(id: string, version?: number) { return this.req<VerifyOut>(`/pdf/${this.e(id)}/signatures${version ? `?version=${version}` : ""}`); }
  createSignatureRequest(body: CreateSignatureRequest) { return this.send<CreatedSignatureRequest>("POST", "/signature-requests", body); }
  listSignatureRequests(document_id: string) { return this.req<SignatureRequest[]>(`/signature-requests?document_id=${this.e(document_id)}`); }
  getSignatureRequest(rid: string) { return this.req<SignatureRequest>(`/signature-requests/${this.e(rid)}`); }
  signatureRequestEvents(rid: string) { return this.req<SignatureEvents>(`/signature-requests/${this.e(rid)}/events`); }
  cancelSignatureRequest(rid: string) { return this.send<SignatureRequest>("POST", `/signature-requests/${this.e(rid)}/cancel`); }
  // public signer flow (no auth)
  getSignSession(token: string) { return this.req<SignSession>(`/sign/${this.e(token)}`, {}, false); }
  signDocumentUrl(token: string) { return this.url(`/sign/${this.e(token)}/document`); }
  completeSigning(token: string, placements: SignerPlacement[]) { return this.req<SignatureRequest>(`/sign/${this.e(token)}/complete`, this.json({ consent: true, consent_text_version: "v1", placements }), false); }
  declineSigning(token: string, reason: string) { return this.req<unknown>(`/sign/${this.e(token)}/decline`, this.json({ reason }), false); }
  // audit
  documentAudit(id: string, limit = 100) { return this.req<AuditEntry[]>(`/documents/${this.e(id)}/audit?limit=${limit}`); }
  // document management
  patchDocument(id: string, patch: DocPatch) { return this.send<DocumentInfo>("PATCH", `/documents/${this.e(id)}`, patch); }
  trashDocument(id: string) { return this.send<DocumentInfo>("DELETE", `/documents/${this.e(id)}`); }
  restoreDocument(id: string) { return this.send<DocumentInfo>("POST", `/documents/${this.e(id)}/restore`); }
  deletePermanently(id: string) { return this.send<void>("DELETE", `/documents/${this.e(id)}?permanent=true`); }
  listFolders() { return this.req<Folder[]>("/folders"); }
  createFolder(name: string, parent_id?: string) { return this.send<Folder>("POST", "/folders", { name, ...(parent_id ? { parent_id } : {}) }); }
  renameFolder(id: string, name: string) { return this.send<Folder>("PATCH", `/folders/${this.e(id)}`, { name }); }
  deleteFolder(id: string) { return this.send<void>("DELETE", `/folders/${this.e(id)}`); }
  listTags() { return this.req<string[]>("/tags"); }
  listShares(id: string) { return this.req<Share[]>(`/documents/${this.e(id)}/shares`); }
  createShare(id: string, body: ShareIn) { return this.send<Share>("POST", `/documents/${this.e(id)}/shares`, body); }
  deleteShare(shareId: string) { return this.send<void>("DELETE", `/shares/${this.e(shareId)}`); }
  sharedInfo(token: string) { return this.req<{ filename: string; version: number; size: number; page_count: number; expires_at: string | null; file_path: string }>(`/shared/${this.e(token)}`, {}, false); }
  sharedFileUrl(token: string) { return this.url(`/shared/${this.e(token)}/file`); }
  // AI (stub provider by default)
  aiAsk(document_id: string, question: string, page_range?: [number, number]) { return this.send<AiAnswer>("POST", "/ai/ask", { document_id, question, ...(page_range ? { page_range } : {}) }); }
  aiSummarize(document_id: string, length: "short" | "long" = "short") { return this.send<AiAnswer>("POST", "/ai/summarize", { document_id, length }); }
}
