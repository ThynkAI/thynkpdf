import { HttpEditorApi, ApiError, VersionConflictError, DocumentSignedError, RateLimitedError } from "./http";
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { "content-type": "application/json" } });
const tok = (a: string) => ({ access_token: a, refresh_token: "r", token_type: "bearer", expires_in: 60 });
describe("HttpEditorApi", () => {
  it("logs in, sends bearer, refreshes on 401 and retries once", async () => {
    const calls: { url: string; auth?: string }[] = [];
    let first = true;
    const f = vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, auth: (init?.headers as Record<string, string>)?.Authorization });
      if (url.endsWith("/auth/login")) return json(tok("a1"));
      if (url.endsWith("/auth/refresh")) return json(tok("a2"));
      if (url.endsWith("/documents/upload")) { if (first) { first = false; return json({}, 401); } return json({ document_id: "d", version_id: "v" }); }
      return json({}, 404);
    });
    const api = new HttpEditorApi({ baseUrl: "http://api/", fetchImpl: f as unknown as typeof fetch });
    await api.login("u", "p");
    const r = await api.upload(new Blob(["%PDF"]), "a.pdf");
    expect(r).toEqual({ document_id: "d", version_id: "v" });
    expect(calls.map((c) => c.url.replace("http://api", ""))).toEqual(["/auth/login", "/documents/upload", "/auth/refresh", "/documents/upload"]);
    expect(calls[2].auth).toBe("Bearer a1"); // refresh itself relies on the httpOnly cookie
    expect(calls[3].auth).toBe("Bearer a2");
    const src = await api.fileSource({ document_id: "d", version_id: "v" });
    expect(src).toEqual({ url: "http://api/documents/d/versions/v/file", httpHeaders: { Authorization: "Bearer a2" } });
  });
  it("throws ApiError on failure and health false on network error", async () => {
    const api = new HttpEditorApi({ baseUrl: "http://x", fetchImpl: (async () => json({}, 500)) as unknown as typeof fetch });
    await expect(api.upload(new Blob([]), "a")).rejects.toBeInstanceOf(ApiError);
    const down = new HttpEditorApi({ baseUrl: "http://x", fetchImpl: (async () => { throw new TypeError("net"); }) as unknown as typeof fetch });
    expect(await down.health()).toBe(false);
  });
  it("maps 409 VERSION_CONFLICT to VersionConflictError and sends expected_version + 1-based pages", async () => {
    let body: any;
    const f = async (_u: string, init?: RequestInit) => { body = JSON.parse(String(init?.body)); return json({ error: { code: "VERSION_CONFLICT", message: "stale", details: { current_version: 4 } } }, 409); };
    const api = new HttpEditorApi({ baseUrl: "http://x", fetchImpl: f as unknown as typeof fetch });
    const err = await api.rotatePages({ document_id: "d", version_id: "v", version: 2 }, [1], 90).catch((e) => e);
    expect(err).toBeInstanceOf(VersionConflictError);
    expect(err.currentVersion).toBe(4);
    expect(body).toEqual({ document_id: "d", expected_version: 2, pages: [1], angle: 90 });
  });
  it("reorder sends 1-based order with expected_version; refresh failure clears tokens", async () => {
    const seen: any[] = []; const changes: unknown[] = [];
    const f = async (url: string, init?: RequestInit) => {
      seen.push([url, init?.body && JSON.parse(String(init.body))]);
      if (url.endsWith("/auth/login")) return json(tok("a1"));
      if (url.endsWith("/auth/refresh")) return json({ error: { code: "TOKEN_INVALID", message: "bad" } }, 401);
      if (url.endsWith("/pdf/pages/reorder")) return json({ document_id: "d", version_id: "v3", version: 3, sha256: "", size: 1, report: {} });
      return json({ error: { code: "TOKEN_EXPIRED", message: "exp" } }, 401);
    };
    const api = new HttpEditorApi({ baseUrl: "http://x", fetchImpl: f as unknown as typeof fetch });
    api.onTokensChanged = (t) => changes.push(t);
    await api.login("u", "p");
    expect((await api.reorderPages({ document_id: "d", version_id: "v", version: 2 }, [2, 1])).version).toBe(3);
    expect(seen[1]).toEqual(["http://x/pdf/pages/reorder", { document_id: "d", expected_version: 2, order: [2, 1] }]);
    await expect(api.getCapabilities("d")).rejects.toBeInstanceOf(ApiError);
    expect(api.getTokens()).toBeNull();
    expect(changes.at(-1)).toBeNull();
  });
  it("cookie refresh: no body, credentials include, ONE in-flight refresh for concurrent 401s, refresh token never kept", async () => {
    let refreshes = 0; let refreshInit: RequestInit | undefined; const creds: (string | undefined)[] = [];
    let n = 0;
    const f = async (url: string, init?: RequestInit) => {
      creds.push(init?.credentials as string | undefined);
      if (url.endsWith("/auth/login")) return json(tok("a1"));
      if (url.endsWith("/auth/refresh")) { refreshes++; refreshInit = init; await new Promise((r) => setTimeout(r, 10)); return json(tok("a2")); }
      const auth = (init?.headers as Record<string, string>)?.Authorization;
      n++;
      return auth === "Bearer a2" ? json({ items: [], next_cursor: null }) : json({ error: { code: "TOKEN_EXPIRED", message: "x" } }, 401);
    };
    const api = new HttpEditorApi({ baseUrl: "http://x", fetchImpl: f as unknown as typeof fetch });
    await api.login("u", "p");
    expect(api.getTokens()?.refresh_token).toBe("");
    const [a, b, c] = await Promise.all([api.listDocuments(), api.listDocuments({ q: "x", starred: true }), api.listDocuments()]);
    expect([a, b, c].every((x) => Array.isArray(x.items))).toBe(true);
    expect(refreshes).toBe(1);
    expect(refreshInit?.body).toBeUndefined();
    expect(refreshInit?.method).toBe("POST");
    expect(creds.every((x) => x === "include")).toBe(true);
    expect(n).toBe(6);
  });
  it("maps DOCUMENT_SIGNED and RATE_LIMITED to distinct errors", async () => {
    const mk = (b: unknown, st: number) => new HttpEditorApi({ baseUrl: "http://x", fetchImpl: (async () => json(b, st)) as unknown as typeof fetch });
    const signed = await mk({ error: { code: "DOCUMENT_SIGNED", message: "signed" } }, 409).deletePages({ document_id: "d", version_id: "v", version: 1 }, [1]).catch((e) => e);
    expect(signed).toBeInstanceOf(DocumentSignedError);
    expect(signed).not.toBeInstanceOf(VersionConflictError);
    const rl = await mk({ error: { code: "RATE_LIMITED", message: "slow", details: { retry_after: 7, limit_per_minute: 20 } } }, 429).aiAsk("d", "q").catch((e) => e);
    expect(rl).toBeInstanceOf(RateLimitedError);
    expect(rl.retryAfter).toBe(7);
  });
  it("sends versioned bodies for page ops, version upload, annotations, forms, placement and restore", async () => {
    const seen: [string, string, unknown][] = [];
    const f = async (url: string, init?: RequestInit) => {
      const b = init?.body instanceof FormData ? Object.fromEntries([...init.body.entries()].map(([k, v]) => [k, typeof v === "string" ? v : "<file>"])) : init?.body ? JSON.parse(String(init.body)) : undefined;
      seen.push([init?.method ?? "GET", url.replace("http://x", ""), b]);
      return init?.method === "DELETE" ? new Response(null, { status: 204 }) : json({ ok: true });
    };
    const api = new HttpEditorApi({ baseUrl: "http://x", fetchImpl: f as unknown as typeof fetch });
    const ref = { document_id: "d", version_id: "v", version: 3 };
    await api.deletePages(ref, [2]); await api.duplicatePages(ref, [1]); await api.insertBlank(ref, 0);
    await api.uploadVersion(ref, new Uint8Array([37]), "a.pdf");
    await api.changeAnnotations(ref, { delete: ["thynk-1"] });
    await api.fillForm(ref, { name: "Ada" }); await api.flattenForm(ref);
    await api.placeSignatures(ref, [{ asset_id: "a", page: 1, rect: [0, 0, 10, 10] }]);
    await api.restoreVersion(ref, "v1");
    await api.deletePermanently("d");
    expect(seen).toEqual([
      ["POST", "/pdf/pages/delete", { document_id: "d", expected_version: 3, pages: [2] }],
      ["POST", "/pdf/pages/duplicate", { document_id: "d", expected_version: 3, pages: [1], position: "after_each" }],
      ["POST", "/pdf/pages/insert-blank", { document_id: "d", expected_version: 3, after_page: 0, count: 1 }],
      ["POST", "/documents/d/versions", { file: "<file>", expected_version: "3" }],
      ["POST", "/pdf/annotations", { document_id: "d", expected_version: 3, delete: ["thynk-1"] }],
      ["POST", "/pdf/forms/fill", { document_id: "d", expected_version: 3, values: { name: "Ada" }, flatten: false }],
      ["POST", "/pdf/forms/flatten", { document_id: "d", expected_version: 3, confirm: true }],
      ["POST", "/pdf/signatures/place", { document_id: "d", expected_version: 3, placements: [{ asset_id: "a", page: 1, rect: [0, 0, 10, 10] }] }],
      ["POST", "/documents/d/versions/v1/restore", { expected_version: 3 }],
      ["DELETE", "/documents/d?permanent=true", undefined],
    ]);
  });
});
