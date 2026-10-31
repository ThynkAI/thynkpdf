import type { EditorApi, TokenResponse, UploadResponse, DocumentRef, VersionResult, DocumentInfo, RotateRequest, RotateAngle } from "./types";

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public details?: Record<string, unknown>) { super(message); }
}
export class VersionConflictError extends ApiError {
  get currentVersion() { return (this.details?.current_version as number | undefined) ?? null; }
}

export interface HttpApiOptions { baseUrl: string; fetchImpl?: typeof fetch }

export class HttpEditorApi implements EditorApi {
  readonly kind = "http" as const;
  private tokens: TokenResponse | null = null;
  private f: typeof fetch;
  constructor(private opts: HttpApiOptions) { this.f = opts.fetchImpl ?? ((...a) => fetch(...a)); }

  get isAuthenticated() { return !!this.tokens; }
  private url(p: string) { return this.opts.baseUrl.replace(/\/$/, "") + p; }
  private authHeaders(): Record<string, string> {
    return this.tokens ? { Authorization: `Bearer ${this.tokens.access_token}` } : {};
  }
  private async req<T>(path: string, init: RequestInit = {}, retry = true): Promise<T> {
    const res = await this.f(this.url(path), { ...init, headers: { ...this.authHeaders(), ...(init.headers as Record<string, string> | undefined) } });
    if (res.status === 401 && retry && this.tokens?.refresh_token) {
      await this.refresh();
      return this.req<T>(path, init, false);
    }
    if (!res.ok) {
      let body: { error?: { code?: string; message?: string; details?: Record<string, unknown> } } = {};
      try { body = await res.json(); } catch { /* non-JSON */ }
      const e = body.error ?? {};
      const Cls = res.status === 409 && e.code === "VERSION_CONFLICT" ? VersionConflictError : ApiError;
      throw new Cls(res.status, e.code ?? "HTTP_" + res.status, e.message ?? `${init.method ?? "GET"} ${path} failed: ${res.status}`, e.details);
    }
    return (await res.json()) as T;
  }
  private json(body: unknown): RequestInit { return { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }; }

  async health() {
    try { return (await this.f(this.url("/health"))).ok; } catch { return false; }
  }
  async login(email: string, password: string) {
    this.tokens = await this.req<TokenResponse>("/auth/login", this.json({ email, password }), false);
    return this.tokens;
  }
  async refresh() {
    if (!this.tokens) throw new ApiError(401, "AUTH_REQUIRED", "not logged in");
    this.tokens = await this.req<TokenResponse>("/auth/refresh", this.json({ refresh_token: this.tokens.refresh_token }), false);
    return this.tokens;
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
}
