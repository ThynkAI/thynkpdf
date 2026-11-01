"""Helpers to drive a packaged THYNKPDF sidecar (extracted from a release AppImage) headless.
Synthetic data only. Never binds anything but 127.0.0.1. Uses ports chosen by the OS unless given."""
import json, os, re, subprocess, time, urllib.request, urllib.error, uuid

class Sidecar:
    def __init__(self, exe, data_dir, port=0, home=None, version="audit"):
        self.exe, self.data, self.port, self.version = exe, data_dir, port, version
        self.env = dict(os.environ); self.env.pop("THYNKPDF_JWT_SECRET", None)
        if home: self.env["HOME"] = home
        self.p = None; self.url = None; self.startup_s = None
    def start(self, timeout=90):
        t0 = time.time()
        self.p = subprocess.Popen([self.exe, "--port", str(self.port), "--data-dir", self.data, "--version", self.version],
                                  stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, env=self.env)
        while time.time() - t0 < timeout:
            line = self.p.stdout.readline()
            m = re.search(r"THYNKPDF_READY (http://\S+)", line or "")
            if m: self.url = m.group(1); self.startup_s = round(time.time() - t0, 2); return self
            if self.p.poll() is not None:
                raise RuntimeError(f"sidecar exited {self.p.returncode}: {line}{self.p.stdout.read()[-2000:]}")
        raise RuntimeError("sidecar not ready")
    def stop(self):
        if self.p and self.p.poll() is None:
            self.p.stdin.close()
            try: self.p.wait(10)
            except subprocess.TimeoutExpired: self.p.kill(); self.p.wait()
        return self.p.returncode
    def kill(self):
        self.p.kill(); self.p.wait()
    def req(self, method, path, body=None, headers=None, tok=None, raw=False):
        h = dict(headers or {})
        if tok: h["Authorization"] = f"Bearer {tok}"
        if isinstance(body, (dict, list)): body = json.dumps(body).encode(); h.setdefault("Content-Type", "application/json")
        r = urllib.request.Request(self.url + path, data=body, headers=h, method=method)
        try:
            with urllib.request.urlopen(r, timeout=120) as resp:
                d = resp.read(); return resp.status, (d if raw else _j(d)), dict(resp.headers)
        except urllib.error.HTTPError as e:
            d = e.read(); return e.code, _j(d), dict(e.headers)
    def upload(self, tok, pdf_bytes, name="synthetic.pdf"):
        b = uuid.uuid4().hex
        body = (f"--{b}\r\nContent-Disposition: form-data; name=\"file\"; filename=\"{name}\"\r\nContent-Type: application/pdf\r\n\r\n").encode() + pdf_bytes + f"\r\n--{b}--\r\n".encode()
        return self.req("POST", "/documents/upload", body, {"Content-Type": f"multipart/form-data; boundary={b}"}, tok)

def _j(d):
    try: return json.loads(d)
    except Exception: return d[:300]
