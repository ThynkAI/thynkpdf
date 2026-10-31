import { HttpEditorApi, ApiError, VersionConflictError } from "./http";
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
});
