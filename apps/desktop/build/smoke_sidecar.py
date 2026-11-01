"""Packaged-sidecar smoke test (BD-01 / BD-02 / BD-03 / BD-04 / BD-05 / BD-11).

Starts the BUILT sidecar the way the Electron shell does (random per-launch key in env) and checks:
* the packaged route set equals the source app's route set (catches feature modules missing from the bundle);
* key, Host and Origin enforcement; accounts disabled; the local workspace is provisioned without a login;
* annotations, forms (add fields + fill), signature placement and page ops (rotate, duplicate, delete) return 2xx
  and produce PDFs that pypdf can read;
* restart on the same data dir keeps the documents (idempotent provisioning, migrations a no-op);
* data dir 0700 and DB 0600 on POSIX.
"""
import json, os, re, secrets, stat, subprocess, sys, tempfile, time, urllib.error, urllib.request, uuid
from pathlib import Path
ROOT = Path(__file__).resolve().parents[3]
D = Path(__file__).resolve().parents[1] / "sidecar/thynkpdf-server"
exe = D / ("thynkpdf-server.exe" if sys.platform == "win32" else "thynkpdf-server")
for p in ["apps/api", "packages/pdf-engine", "packages/storage", "packages/signatures", "packages/ai"]: sys.path.insert(0, str(ROOT / p))


def start(data, key):
    env = {**os.environ, "THYNKPDF_DESKTOP_SECRET": key}
    p = subprocess.Popen([str(exe), "--data-dir", data, "--version", "0.0.0-smoke"], stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True, env=env)
    t0 = time.time()
    while time.time() - t0 < 90:
        line = p.stdout.readline()
        m = re.search(r"THYNKPDF_READY (http://\S+)", line or "")
        if m: return p, m.group(1)
        if p.poll() is not None: sys.exit(f"sidecar exited early: {p.returncode}")
    sys.exit("sidecar never became ready")


def call(url, path, key=None, body=None, tok=None, method=None, headers=None, raw=False):
    h = dict(headers or {})
    if key: h["X-Thynkpdf-Key"] = key
    if tok: h["Authorization"] = f"Bearer {tok}"
    data = None
    if isinstance(body, (dict, list)): data = json.dumps(body).encode(); h["Content-Type"] = "application/json"
    elif isinstance(body, tuple): data, h["Content-Type"] = body
    req = urllib.request.Request(url + path, data, h, method=method or ("POST" if data is not None else "GET"))
    try:
        with urllib.request.urlopen(req, timeout=60) as r: b = r.read(); return r.status, (b if raw else (json.loads(b) if b else None))
    except urllib.error.HTTPError as e:
        b = e.read(); return e.code, (json.loads(b) if b[:1] == b"{" else b)


def multipart(name, fname, content, ctype):
    b = uuid.uuid4().hex
    return (f"--{b}\r\nContent-Disposition: form-data; name=\"{name}\"; filename=\"{fname}\"\r\nContent-Type: {ctype}\r\n\r\n".encode() + content + f"\r\n--{b}--\r\n".encode(), f"multipart/form-data; boundary={b}")


def ok(st, j, what):
    assert 200 <= st < 300, f"{what}: HTTP {st} {j}"
    return j


def main():
    data = tempfile.mkdtemp(); key = secrets.token_urlsafe(32)
    p, url = start(data, key)
    try:
        # BD-01: route set
        st, spec = call(url, "/openapi.json", key)
        packaged = {(m.upper(), path) for path, ops in ok(st, spec, "openapi")["paths"].items() for m in ops}
        # openapi lists include_in_schema routes only; compare with the same view of the source app
        from thynkpdf_api.main import create_app
        sspec = create_app("sqlite://", tempfile.mkdtemp(), auth_mode="desktop").openapi()
        src_docs = {(m.upper(), path) for path, ops in sspec["paths"].items() for m in ops}
        missing = src_docs - packaged
        assert not missing, f"packaged sidecar is missing {len(missing)} routes: {sorted(missing)[:10]}"
        print(f"routes: packaged={len(packaged)} source={len(src_docs)}")
        # BD-05 / BD-02 guard
        host = url.split("//")[1]
        assert call(url, "/health")[0] == 200
        assert call(url, "/session/local", body={})[1]["error"]["code"] == "DESKTOP_KEY_REQUIRED"
        assert call(url, "/session/local", key, body={}, headers={"Host": "evil.example"})[0] == 403
        assert call(url, "/session/local", key, body={}, headers={"Origin": "http://evil.example"})[0] == 403
        assert call(url, "/auth/register", key, body={"email": "a@b.example.com", "password": "correct-horse-1", "org_name": "x"})[1]["error"]["code"] == "ACCOUNTS_DISABLED"
        assert b"<html" in urllib.request.urlopen(urllib.request.Request(url + "/", headers={"Accept": "text/html"})).read()
        tok = ok(*call(url, "/session/local", key, body={}, headers={"Origin": f"http://{host}"}), "session")["access_token"]
        A = dict(key=key, tok=tok)
        pdf = (ROOT / "packages/backend-tests/fixtures/simple-3page.pdf").read_bytes()
        up = ok(*call(url, "/documents/upload", body=multipart("file", "a.pdf", pdf, "application/pdf"), **A), "upload")
        doc = up["document_id"]; v = up["version"]
        def op(path, body):
            nonlocal v
            r = ok(*call(url, path, body={"document_id": doc, "expected_version": v, **body}, **A), path); v = r["version"]; return r
        op("/pdf/annotations", {"add": [{"type": "text", "page": 1, "rect": [72, 700, 92, 720], "contents": "smoke"}]})
        op("/pdf/forms/fields", {"add": [{"name": "full_name", "type": "text", "page": 1, "rect": [72, 600, 300, 620]}]})
        op("/pdf/forms/fill", {"values": {"full_name": "Smoke Test"}})
        asset = ok(*call(url, "/signatures/assets", body={"kind": "typed", "text": "Smoke Signer", "font": "Times-Italic"}, **A), "asset")["asset_id"]
        op("/pdf/signatures/place", {"placements": [{"asset_id": asset, "page": 1, "rect": [320, 100, 560, 160]}]})
        op("/pdf/pages/rotate", {"angle": 90})
        op("/pdf/pages/duplicate", {"pages": [1]})
        op("/pdf/pages/delete", {"pages": [4]})
        st, out = call(url, f"/documents/{doc}/download", raw=True, **A); ok(st, None, "download")
        import io, pypdf
        r = pypdf.PdfReader(io.BytesIO(out))
        assert len(r.pages) == 3 and r.get_fields()["full_name"].get("/V") == "Smoke Test", "edited PDF content wrong"
        assert any(a.get_object()["/Subtype"] == "/Text" for a in r.pages[0].get("/Annots", [])), "annotation missing"
        # BD-06: remote features are local-only on desktop
        assert call(url, f"/documents/{doc}/shares", body={"email": None}, **A)[1]["error"]["code"] == "DESKTOP_LOCAL_ONLY"
        print(f"features ok: doc v{v}")
    finally:
        p.stdin.close(); p.wait(timeout=15)
    # restart: same data, new key -> same workspace, no login
    key2 = secrets.token_urlsafe(32); p, url = start(data, key2)
    try:
        assert call(url, "/session/local", key, body={})[0] == 403, "old launch key must not work after restart"
        tok = ok(*call(url, "/session/local", key2, body={}), "session2")["access_token"]
        docs = ok(*call(url, "/documents", key=key2, tok=tok), "list")
        items = docs["items"] if isinstance(docs, dict) else docs
        assert len(items) == 1 and items[0]["current_version"] == v, items
    finally:
        p.stdin.close(); p.wait(timeout=15)
    if os.name == "posix":
        assert stat.S_IMODE(os.stat(data).st_mode) == 0o700, oct(os.stat(data).st_mode)
        assert stat.S_IMODE(os.stat(Path(data) / "thynkpdf.db").st_mode) == 0o600
    print("SIDECAR_SMOKE_OK", url, "exit", p.returncode)


if __name__ == "__main__":
    main()
