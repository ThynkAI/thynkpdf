"""THYNKPDF desktop sidecar: FastAPI backend + static web app + launcher on one localhost origin.

Usage: thynkpdf-server --port 0 --data-dir <app-data dir> [--web-dir DIR] [--launcher-dir DIR]
Prints `THYNKPDF_READY http://127.0.0.1:<port>` on stdout once listening. Exits when stdin closes
(the desktop shell holds the pipe) or on SIGTERM, so it never outlives the app.
"""
import argparse, mimetypes, os, secrets, socket, sys, threading
from pathlib import Path

FROZEN = getattr(sys, "frozen", False)
BASE = Path(getattr(sys, "_MEIPASS", Path(__file__).resolve().parents[3]))
if not FROZEN:
    for p in ["apps/api", "packages/pdf-engine", "packages/storage", "packages/signatures", "packages/ai"]:
        sys.path.insert(0, str(BASE / p))
mimetypes.add_type("text/javascript", ".mjs"); mimetypes.add_type("application/wasm", ".wasm")


def free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0)); return s.getsockname()[1]


def prepare_env(data: Path, port: int):
    data.mkdir(parents=True, exist_ok=True)
    sec = data / "jwt-secret"
    if not sec.exists():
        sec.write_text(secrets.token_urlsafe(48)); os.chmod(sec, 0o600)
    os.environ["THYNKPDF_ENV_FILE"] = str(data / "settings.env")  # optional user overrides
    os.environ.setdefault("THYNKPDF_JWT_SECRET", sec.read_text().strip())
    os.environ["THYNKPDF_DATABASE_URL"] = "sqlite:///" + (data / "thynkpdf.db").as_posix()
    os.environ["THYNKPDF_STORAGE_ROOT"] = str(data / "objects")
    os.environ["THYNKPDF_CORS_ORIGINS"] = f"http://127.0.0.1:{port},http://localhost:{port}"
    os.chdir(data)  # any relative default (e.g. dev signing cert) lands in app data, never in Program Files


def build_app(web_dir: Path | None, launcher_dir: Path | None, version: str):
    from fastapi.responses import JSONResponse
    from fastapi.staticfiles import StaticFiles
    from thynkpdf_api.main import create_app
    app = create_app()

    @app.get("/desktop/info", include_in_schema=False)
    def info(): return JSONResponse({"version": version, "desktop": True})

    if launcher_dir and launcher_dir.is_dir():
        app.mount("/desktop", StaticFiles(directory=launcher_dir, html=True), name="launcher")
    if web_dir and web_dir.is_dir():  # mounted last: API routes above always win
        from fastapi.responses import FileResponse
        # Pages of the web app whose paths also exist in the API (e.g. /documents): browser navigations get the HTML page.
        pages = {"/" + d.parent.relative_to(web_dir).as_posix().strip(".") for d in web_dir.rglob("index.html")}

        @app.middleware("http")
        async def web_pages(request, call_next):
            path = request.url.path.rstrip("/") or "/"
            if (request.method == "GET" and path in pages and path != "/"
                    and "text/html" in request.headers.get("accept", "") and request.headers.get("sec-fetch-mode", "navigate") == "navigate"):
                return FileResponse(web_dir / path.lstrip("/") / "index.html")
            return await call_next(request)
        app.mount("/", StaticFiles(directory=web_dir, html=True), name="web")
    return app


def watch_stdin():
    try:
        while sys.stdin.read(1024): pass
    except Exception: pass
    os._exit(0)


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=0); ap.add_argument("--data-dir", required=True)
    ap.add_argument("--web-dir"); ap.add_argument("--launcher-dir"); ap.add_argument("--version", default="dev")
    ap.add_argument("--no-stdin-watch", action="store_true")
    a = ap.parse_args(argv)
    port = a.port or free_port()
    web = (Path(a.web_dir) if a.web_dir else BASE / "web").resolve()
    launcher = (Path(a.launcher_dir) if a.launcher_dir else BASE / "launcher").resolve()
    prepare_env(Path(a.data_dir).expanduser(), port)
    app = build_app(web, launcher, a.version)
    import uvicorn
    cfg = uvicorn.Config(app, host="127.0.0.1", port=port, log_level="warning")
    srv = uvicorn.Server(cfg)
    orig = srv.startup
    async def startup(sockets=None):
        await orig(sockets=sockets); print(f"THYNKPDF_READY http://127.0.0.1:{port}", flush=True)
    srv.startup = startup
    if not a.no_stdin_watch: threading.Thread(target=watch_stdin, daemon=True).start()
    srv.run()


if __name__ == "__main__":
    main()
