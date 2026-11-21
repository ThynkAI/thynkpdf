"""Stage 8: sidecar startup, RSS and latency under large merge/compress and a flate bomb. Usage: python tools/audit/perf.py <thynkpdf-server>"""
import json, sys, tempfile, threading, time
from pathlib import Path
HERE = Path(__file__).resolve().parent; sys.path.insert(0, str(HERE)); from sidecar import Sidecar
C = HERE / "corpus"; d = tempfile.mkdtemp(); R = {}
def rss(pid):
    tot = 0
    for line in open(f"/proc/{pid}/status"):
        if line.startswith("VmRSS"): tot = int(line.split()[1]) // 1024
    return tot
sc = Sidecar(sys.argv[1], d + "/data", home=d).start(); R["startup_s"] = sc.startup_s; R["idle_rss_mib"] = rss(sc.p.pid)
tok = sc.req("POST", "/auth/register", {"email": "p@example.com", "password": "synthetic-pass-123", "org_name": "P"})[1]["access_token"]
def timed(fn):
    peak = [0]; done = [False]; lat = []
    def mon():
        while not done[0]:
            peak[0] = max(peak[0], rss(sc.p.pid)); t = time.time(); sc.req("GET", "/health"); lat.append(time.time() - t); time.sleep(0.05)
    th = threading.Thread(target=mon); th.start(); t0 = time.time(); r = fn(); el = time.time() - t0; done[0] = True; th.join()
    return {"seconds": round(el, 2), "peak_rss_mib": peak[0], "health_p_max_ms": round(max(lat or [0]) * 1000), "status": r[0]}
t0 = time.time(); st, up, _ = sc.upload(tok, (C / "large_2000p.pdf").read_bytes()); R["upload_2000p_s"] = round(time.time() - t0, 2); L = up["document_id"]
R["merge_2x2000p"] = timed(lambda: sc.req("POST", "/pdf/merge", {"document_ids": [L] * 2, "filename": "m.pdf"}, tok=tok))
R["compress_2000p_balanced"] = timed(lambda: sc.req("POST", "/pdf/compress", {"document_id": L, "expected_version": 1, "preset": "balanced"}, tok=tok))
st, up, _ = sc.upload(tok, (C / "flate_bomb_512MiB.pdf").read_bytes()); R["bomb_upload_status"] = st
if st == 201:
    B = up["document_id"]; R["bomb_compress"] = timed(lambda: sc.req("POST", "/pdf/compress", {"document_id": B, "expected_version": 1, "preset": "high"}, tok=tok))
    R["bomb_capabilities"] = timed(lambda: sc.req("GET", f"/pdf/{B}/capabilities", tok=tok))
R["rss_after_mib"] = rss(sc.p.pid); sc.stop(); print(json.dumps(R, indent=1)); json.dump(R, open(HERE / "perf_results.json", "w"), indent=1)
