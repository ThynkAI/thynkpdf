"""Start the built sidecar, wait for READY, hit /health, the launcher and the web app, upload a PDF, then close stdin and check it exits."""
import json, re, subprocess, sys, tempfile, time, urllib.request, uuid
from pathlib import Path
D = Path(__file__).resolve().parents[1] / "sidecar/thynkpdf-server"
exe = D / ("thynkpdf-server.exe" if sys.platform == "win32" else "thynkpdf-server")
data = tempfile.mkdtemp()
p = subprocess.Popen([str(exe), "--data-dir", data, "--version", "0.0.0-smoke"], stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True)
t0 = time.time(); url = None
while time.time() - t0 < 90:
    line = p.stdout.readline()
    m = re.search(r"THYNKPDF_READY (http://\S+)", line or "")
    if m: url = m.group(1); break
    if p.poll() is not None: sys.exit(f"sidecar exited early: {p.returncode}")
assert url, "sidecar never became ready"
get = lambda path, h={}: urllib.request.urlopen(urllib.request.Request(url + path, headers=h), timeout=20)
assert json.load(get("/health"))["status"] == "ok"
assert b"What do you want to do" in get("/desktop/", {"Accept": "text/html"}).read()
assert b"<html" in get("/", {"Accept": "text/html"}).read()
req = urllib.request.Request(url + "/auth/register", json.dumps({"email": "smoke@desk.example.com", "password": "correct-horse-1", "org_name": "S"}).encode(), {"Content-Type": "application/json"})
tok = json.load(urllib.request.urlopen(req))["access_token"]
pdf = (Path(__file__).resolve().parents[3] / "packages/backend-tests/fixtures/simple-3page.pdf").read_bytes()
b = uuid.uuid4().hex
body = f"--{b}\r\nContent-Disposition: form-data; name=\"file\"; filename=\"a.pdf\"\r\nContent-Type: application/pdf\r\n\r\n".encode() + pdf + f"\r\n--{b}--\r\n".encode()
up = json.load(urllib.request.urlopen(urllib.request.Request(url + "/documents/upload", body, {"Content-Type": f"multipart/form-data; boundary={b}", "Authorization": f"Bearer {tok}"})))
assert up["document_id"]
p.stdin.close(); p.wait(timeout=15)
print("SIDECAR_SMOKE_OK", url, "exit", p.returncode)
