import type { EditorApi, TokenResponse, UploadResponse, DocumentRef, PageOpResponse } from "./types";

export class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
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
    return this.tokens ? { Authorization: `${this.tokens.token_type || "bearer"} ${this.tokens.access_token}` } : {};
  }
  private async req<T>(path: string, init: RequestInit = {}, retry = true): Promise<T> {
    const res = await this.f(this.url(path), { ...init, headers: { ...this.authHeaders(), ...(init.headers as Record<string, string> | undefined) } });
    if (res.status === 401 && retry && this.tokens?.refresh_token) {
      await this.refresh();
      return this.req<T>(path, init, false);
    }
    if (!res.ok) throw new ApiError(res.status, `${init.method ?? "GET"} ${path} failed: ${res.status}`);
    return (await res.json()) as T;
  }

  async health() {
    try {
      const r = await this.f(this.url("/health"), { method: "GET" });
      return r.ok;
    } catch { return false; }
  }
  async login(username: string, password: string) {
    this.tokens = await this.req<TokenResponse>("/auth/login", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username, email: username, password }),
    }, false);
    return this.tokens;
  }
  async refresh() {
    if (!this.tokens) throw new ApiError(401, "not logged in");
    this.tokens = await this.req<TokenResponse>("/auth/refresh", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ refresh_token: this.tokens.refresh_token }),
    }, false);
    return this.tokens;
  }
  async upload(file: Blob, filename: string) {
    const fd = new FormData();
    fd.append("file", file, filename);
    return this.req<UploadResponse>("/documents/upload", { method: "POST", body: fd });
  }
  async fileSource(ref: DocumentRef) {
    return { url: this.url(`/documents/${ref.document_id}/versions/${ref.version_id}/file`), httpHeaders: this.authHeaders() };
  }
  /** ASSUMED route; confirm against docs/openapi.json once published. */
  async rotatePages(ref: DocumentRef, pages: number[], degrees: 90 | 180 | 270) {
    return this.req<PageOpResponse>(`/documents/${ref.document_id}/versions/${ref.version_id}/pages/rotate`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ pages, degrees }),
    });
  }
}
