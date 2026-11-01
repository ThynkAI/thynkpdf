"""Stage 4 diagnostic: upgrade v0.1.0 -> v0.1.5 data dir, Alembic-vs-create_all, missing objects, read-only storage,
corrupt DB, SIGKILL mid-operation. Synthetic data only.
Usage: python tools/audit/upgrade_recovery.py <old thynkpdf-server> <new thynkpdf-server> <workdir>"""
import json, os, shutil, signal, sqlite3, subprocess, sys, threading, time
from pathlib import Path
HERE = Path(__file__).resolve().parent; ROOT = HERE.parents[1]; sys.path.insert(0, str(HERE))
from sidecar import Sidecar
old, new, work = sys.argv[1], sys.argv[2], Path(sys.argv[3]); shutil.rmtree(work, ignore_errors=True); work.mkdir(parents=True)
home = work / "home"; data = home / ".config/THYNKPDF/data"; C = HERE / "corpus"; R = {}
def log(k, v): R[k] = v; print(k, "=>", json.dumps(v, default=str)[:400])
reg = {"email": "local@example.com", "password": "synthetic-pass-123", "org_name": "Local"}
# 1) old release creates data
a = Sidecar(old, str(data), home=str(home), version="0.1.0").start(); tok = a.req("POST", "/auth/register", reg)[1]["access_token"]
doc = a.upload(tok, (C / "std_text.pdf").read_bytes())[1]["document_id"]
a.req("POST", "/pdf/pages/rotate", {"document_id": doc, "expected_version": 1, "angle": 90}, tok=tok); a.stop()
shutil.copytree(data, work / "backup-v010")
# 2) new release on same data
b = Sidecar(new, str(data), home=str(home), version="0.1.5").start()
st, t, _ = b.req("POST", "/auth/login", reg); tok = t["access_token"]; log("upgrade_login", st)
st, v, _ = b.req("GET", f"/documents/{doc}/versions", tok=tok); log("upgrade_versions", [st, [x["operation"] for x in v]])
st, raw, _ = b.req("GET", f"/documents/{doc}/download", tok=tok, raw=True); log("upgrade_download", [st, len(raw)])
b.stop()
con = sqlite3.connect(data / "thynkpdf.db"); log("alembic_version_present", bool(con.execute("select 1 from sqlite_master where name='alembic_version'").fetchone())); con.close()
# 3) would the repo's migration path work on a desktop DB? (alembic upgrade head against a create_all DB)
env = dict(os.environ, THYNKPDF_DATABASE_URL="sqlite:///" + str(work / "alembic-on-desktop.db"))
shutil.copy(data / "thynkpdf.db", work / "alembic-on-desktop.db")
p = subprocess.run([sys.executable, str(ROOT / "scripts/migrate.py")], cwd=ROOT, env=env, capture_output=True, text=True)
log("alembic_upgrade_on_desktop_db", {"rc": p.returncode, "tail": (p.stderr or p.stdout).strip().splitlines()[-1:] })
# fresh alembic DB vs create_all DB schema diff
env2 = dict(os.environ, THYNKPDF_DATABASE_URL="sqlite:///" + str(work / "alembic-fresh.db"))
p = subprocess.run([sys.executable, str(ROOT / "scripts/migrate.py")], cwd=ROOT, env=env2, capture_output=True, text=True); log("alembic_fresh_rc", p.returncode)
def schema(db):
    c = sqlite3.connect(db); out = {}
    for (t,) in c.execute("select name from sqlite_master where type='table' and name not like 'sqlite_%' and name!='alembic_version'"):
        out[t] = sorted(r[1] for r in c.execute(f"pragma table_info({t})"))
    return out
sa, sb = schema(work / "alembic-fresh.db"), schema(data / "thynkpdf.db")
log("schema_diff_alembic_vs_desktop", {"only_alembic": sorted(set(sa) - set(sb)), "only_desktop": sorted(set(sb) - set(sa)),
    "col_diffs": {t: [sorted(set(sa[t]) - set(sb[t])), sorted(set(sb[t]) - set(sa[t]))] for t in set(sa) & set(sb) if sa[t] != sb[t]}})
# 4) missing storage object
c = Sidecar(new, str(data), home=str(home)).start(); tok = c.req("POST", "/auth/login", reg)[1]["access_token"]
objs = sorted((data / "objects").rglob("*.pdf")); victim = objs[-1]; victim.rename(victim.with_suffix(".hidden"))
st, b2, _ = c.req("GET", f"/documents/{doc}/download", tok=tok, raw=True); log("missing_object_download", [st, b2[:120] if isinstance(b2, bytes) else b2])
st, b2, _ = c.req("POST", "/pdf/pages/rotate", {"document_id": doc, "expected_version": 2, "angle": 90}, tok=tok); log("missing_object_rotate", [st, b2])
st, b2, _ = c.req("GET", "/documents", tok=tok); log("missing_object_list", st)
victim.with_suffix(".hidden").rename(victim)
# 5) read-only storage (stand-in for disk full / permission denied)
os.chmod(data / "objects", 0o555)
for d_ in (data / "objects").rglob("*"):
    if d_.is_dir(): os.chmod(d_, 0o555)
st, b2, _ = c.upload(tok, (C / "std_text.pdf").read_bytes()); log("readonly_storage_upload", [st, b2])
st, b2, _ = c.req("POST", "/pdf/pages/rotate", {"document_id": doc, "expected_version": 2, "angle": 90}, tok=tok); log("readonly_storage_rotate", [st, b2])
for d_ in [data / "objects", *(data / "objects").rglob("*")]:
    if d_.is_dir(): os.chmod(d_, 0o755)
st, d2, _ = c.req("GET", f"/documents/{doc}", tok=tok); log("after_readonly_current_version", d2.get("current_version") if isinstance(d2, dict) else d2)
# 6) SIGKILL during a long operation (merge of 2x large) then restart and check consistency
L = c.upload(tok, (C / "large_2000p.pdf").read_bytes())[1]["document_id"]
before = len(list((data / "objects").rglob("*.pdf")))
th = threading.Thread(target=lambda: c.req("POST", "/pdf/merge", {"document_ids": [L, L, L, L], "filename": "m.pdf"}, tok=tok), daemon=True); th.start()
time.sleep(0.4); c.p.send_signal(signal.SIGKILL); c.p.wait(); time.sleep(0.5)
d = Sidecar(new, str(data), home=str(home)).start(); tok = d.req("POST", "/auth/login", reg)[1]["access_token"]
con = sqlite3.connect(data / "thynkpdf.db")
keys = {r[0] for r in con.execute("select storage_key from document_versions")}
files = {str(p.relative_to(data / "objects")) for p in (data / "objects").rglob("*") if p.is_file()}
log("after_sigkill", {"db_rows_without_object": len(keys - files), "orphan_or_tmp_files": len(files - keys), "tmp_files": len([f for f in files if f.endswith(".tmp")]),
                      "integrity_check": con.execute("pragma integrity_check").fetchone()[0], "journal_mode": con.execute("pragma journal_mode").fetchone()[0]})
con.close()
st, lst, _ = d.req("GET", "/documents", tok=tok); log("after_sigkill_list", [st, len(lst["items"])]); d.stop()
# 7) corrupt DB -> startup behaviour
shutil.copy(data / "thynkpdf.db", work / "db.bak"); (data / "thynkpdf.db").write_bytes(b"not a database" * 100)
try:
    e = Sidecar(new, str(data), home=str(home)).start(timeout=20); st, b3, _ = e.req("POST", "/auth/login", reg); log("corrupt_db", ["started", st, b3]); e.stop()
except Exception as ex: log("corrupt_db", ["failed_to_start", str(ex)[-300:]])
shutil.copy(work / "db.bak", data / "thynkpdf.db")
# 8) jwt-secret deleted (e.g. partial restore) -> existing refresh tokens
json.dump(R, open(work / "upgrade_recovery_results.json", "w"), indent=1, default=str)
