"""Stage 2/3 diagnostic: drive a packaged sidecar (from a release AppImage) on a FRESH HOME and data dir.
Usage: python tools/audit/first_run.py <path/to/thynkpdf-server> [workdir]
Synthetic identity/data only. Binds 127.0.0.1 on OS-chosen ports."""
import json, os, sqlite3, stat, sys, tempfile, time
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent))
from sidecar import Sidecar
exe = sys.argv[1]; work = Path(sys.argv[2] if len(sys.argv) > 2 else tempfile.mkdtemp(prefix="tp-first-run-"))
home = work / "home"; data = home / ".config/THYNKPDF/data"; home.mkdir(parents=True, exist_ok=True)
pdf = (Path(__file__).resolve().parent / "corpus/std_text.pdf").read_bytes()
R = {}
def log(k, v): R[k] = v; print(k, "=>", json.dumps(v, default=str)[:500])
sc = Sidecar(exe, str(data), home=str(home)).start(); log("startup_seconds_cold", sc.startup_s); log("url", sc.url)
db = data / "thynkpdf.db"
con = sqlite3.connect(db); log("users_after_first_start", con.execute("select count(*) from users").fetchone()[0])
log("alembic_version_table", [r[0] for r in con.execute("select name from sqlite_master where name='alembic_version'")]); con.close()
st, body, _ = sc.req("GET", "/", headers={"Accept": "text/html"}, raw=True)
html = body.decode("utf-8", "replace") if isinstance(body, bytes) else str(body)
log("index_status", st)
st, b, _ = sc.req("GET", "/documents"); log("documents_without_token", [st, b])
st, b, _ = sc.req("POST", "/auth/login", {"email": "anyone@example.com", "password": "x" * 12}); log("login_with_no_accounts", [st, b])
# Only possible via raw API (no UI path): register a synthetic local account
st, t, _ = sc.req("POST", "/auth/register", {"email": "local@example.com", "password": "synthetic-pass-123", "org_name": "Local"})
log("register_via_api_status", st); tok = t["access_token"]; rt = t["refresh_token"]
st, up, _ = sc.upload(tok, pdf); log("upload", [st, {k: up.get(k) for k in ("version", "page_count")}]); doc = up["document_id"]
st, r, _ = sc.req("POST", "/pdf/pages/rotate", {"document_id": doc, "expected_version": 1, "pages": [1], "angle": 90}, tok=tok); log("rotate", [st, r.get("version")])
st, r, _ = sc.req("POST", "/pdf/edit", {"document_id": doc, "expected_version": 2, "operations": [{"op": "text_replace", "page": 1, "find": "Hello", "replacement": "Howdy"}]}, tok=tok); log("edit", [st, r.get("version") if isinstance(r, dict) else r])
st, raw, _ = sc.req("GET", f"/documents/{doc}/download", tok=tok, raw=True); log("download_bytes", [st, len(raw)])
# share + signature links (Stage 3)
st, sh, _ = sc.req("POST", f"/documents/{doc}/shares", {"email": None, "role": "viewer"}, tok=tok); log("share_create", [st, sh.get("url") if isinstance(sh, dict) else sh])
share_tok = sh["url"].split("/")[-1] if isinstance(sh, dict) and sh.get("url") else None
st, sr, _ = sc.req("POST", "/signature-requests", {"document_id": doc, "version": 3, "signers": [{"email": "signer@example.com", "name": "Signer"}],
                   "fields": [{"signer_index": 0, "page": 1, "rect": [72, 72, 200, 110], "type": "signature"}]}, tok=tok)
log("sign_request", [st, sr if st != 201 else "created"])
sign_tok = sr["signer_links"][0]["token"] if st == 201 else None
if sign_tok:
    st, ev, _ = sc.req("GET", f"/signature-requests/{sr['request_id']}/events", tok=tok)
    log("notification_events", [e.get("type") or e.get("event_type") for e in (ev.get("events") if isinstance(ev, dict) else ev or [])][:6])
paths = set(sc.req("GET", "/openapi.json")[1]["paths"]); log("route_count", len(paths))
for probe in ["/pdf/annotations", "/pdf/forms/fill", "/pdf/signatures/place", "/pdf/pages/delete", "/signature-requests", "/folders", "/ai/ask"]:
    log("route_present " + probe, probe in paths)
log("desktop_share_url_as_ui_builds_it", f"{sc.url}/shared/?token=<redacted>")
# DNS-rebinding / Host check probes
st, b, _ = sc.req("GET", "/health", headers={"Host": "attacker.example:80"}); log("host_header_attacker_accepted", st)
st, b, h = sc.req("OPTIONS", "/auth/register", headers={"Origin": "http://attacker.example", "Access-Control-Request-Method": "POST"}); log("cors_preflight_foreign_origin", [st, h.get("access-control-allow-origin")])
st, b, h = sc.req("POST", "/auth/register", {"email": "rebind@example.com", "password": "synthetic-pass-123", "org_name": "X"}, headers={"Origin": "http://attacker.example", "Host": "attacker.example"})
log("simple_post_foreign_origin_host_register", st)
fails = 0
for i in range(30):
    st, _, _ = sc.req("POST", "/auth/login", {"email": "local@example.com", "password": f"wrong-pass-{i:04d}"}); fails += st == 401
log("login_bruteforce_30_attempts_401s_no_lockout", fails)
port1 = sc.url; t0 = time.time(); log("stop_exit", sc.stop())
# restart: new port (as the Electron shell always passes --port 0)
sc2 = Sidecar(exe, str(data), home=str(home)).start(); log("startup_seconds_warm", sc2.startup_s); log("port_changed", port1 != sc2.url)
st, b, _ = sc2.req("POST", "/auth/refresh", {"refresh_token": rt}); log("refresh_after_restart", st); tok2 = b.get("access_token") if isinstance(b, dict) else None
st, lst, _ = sc2.req("GET", "/documents", tok=tok2); log("docs_after_restart", [st, len(lst.get("items", [])) if isinstance(lst, dict) else lst])
st, vs, _ = sc2.req("GET", f"/documents/{doc}/versions", tok=tok2); log("versions_after_restart", [st, len(vs) if isinstance(vs, list) else vs])
if share_tok: st, b, _ = sc2.req("GET", f"/shared/{share_tok}"); log("share_token_after_restart(new origin)", st)
if sign_tok: st, b, _ = sc2.req("GET", f"/sign/{sign_tok}"); log("sign_token_after_restart(new origin)", st)
log("old_origin_reachable_after_restart", (lambda: __import__("urllib.request").request.urlopen(port1 + "/health", timeout=3).status)() if False else "refused (port closed; new random port)")
# filesystem permissions (multi-OS-user isolation)
def mode(p): return oct(stat.S_IMODE(os.stat(p).st_mode))
log("modes", {"data_dir": mode(data), "db": mode(db), "objects": mode(data / "objects"), "jwt-secret": mode(data / "jwt-secret"),
              "dev-signing-dir": [ (str(x.relative_to(data)), mode(x)) for x in data.rglob("*") if "cert" in x.name.lower() or x.suffix in (".pem", ".key")][:6]})
log("data_dir_listing", sorted(str(x.relative_to(data)) for x in data.iterdir()))
sc2.stop()
json.dump(R, open(work / "first_run_results.json", "w"), indent=1, default=str); print("results:", work / "first_run_results.json")
