"""Protection for the desktop sidecar's localhost API (BD-02 / BD-05).

* Host must be 127.0.0.1:<port> or localhost:<port> (blocks DNS rebinding).
* A present Origin must be the app's own origin.
* Every API route (not the static web app) needs X-Thynkpdf-Key == the per-launch secret that the Electron shell
  generated and passed via env. Only the app's own window gets it (preload IPC, origin-checked).
"""
import hmac
from fastapi.responses import JSONResponse
from starlette.routing import Match, Mount

HEADER = "x-thynkpdf-key"
OPEN_PATHS = {"/health", "/desktop/info"}


def _deny(code, msg, request=None):
    if request is not None:  # never log the key itself
        import sys
        print(f"[guard] {code} {request.method} {request.url.path} host={request.headers.get('host')!r} origin={request.headers.get('origin')!r} key={'yes' if request.headers.get(HEADER) else 'no'}", file=sys.stderr, flush=True)
    return JSONResponse({"error": {"code": code, "message": msg, "details": {}}}, status_code=403)


def install(app, port: int, secret: str, extra_origins=()):
    """Call after all API routes are registered and BEFORE mounting the static web app."""
    if not secret or len(secret) < 32: raise RuntimeError("desktop secret missing or too short")
    hosts = {f"127.0.0.1:{port}", f"localhost:{port}"}
    origins = {f"http://{h}" for h in hosts} | set(extra_origins)
    api_routes = [r for r in app.router.routes if not isinstance(r, Mount)]

    def is_api(scope):
        return any(r.matches(scope)[0] != Match.NONE for r in api_routes)

    @app.middleware("http")
    async def secret_guard(request, call_next):
        if request.url.path not in OPEN_PATHS and request.method != "OPTIONS" and is_api(request.scope):
            got = request.headers.get(HEADER, "")
            if not hmac.compare_digest(got.encode(), secret.encode()):
                return _deny("DESKTOP_KEY_REQUIRED", "This local API only answers the THYNKPDF app", request)
        return await call_next(request)

    def host_origin_guard(request):
        if request.headers.get("host", "") not in hosts: return _deny("HOST_NOT_ALLOWED", "Host not allowed", request)
        o = request.headers.get("origin")
        if o is not None and o not in origins: return _deny("ORIGIN_NOT_ALLOWED", "Origin not allowed", request)
        return None
    return host_origin_guard
