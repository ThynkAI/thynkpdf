import os as _os
from pathlib import Path as _Path


def _load_env_file():
    """Load KEY=VALUE lines from THYNKPDF_ENV_FILE or <repo>/.env without overriding real env vars (used by the one-click installers)."""
    f = _Path(_os.getenv("THYNKPDF_ENV_FILE") or _Path(__file__).resolve().parents[3] / ".env")
    if not f.is_file(): return
    for line in f.read_text(encoding="utf-8-sig").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line: continue
        k, v = line.split("=", 1); k, v = k.strip(), v.strip().strip('"').strip("'")
        if k and k not in _os.environ: _os.environ[k] = v


_load_env_file()
import os, secrets
class Settings:
    database_url = os.getenv("THYNKPDF_DATABASE_URL", "sqlite:///./thynkpdf.db")
    storage_root = os.getenv("THYNKPDF_STORAGE_ROOT", "./data/objects")
    jwt_secret = os.getenv("THYNKPDF_JWT_SECRET") or secrets.token_urlsafe(48)  # ephemeral if unset
    access_ttl = int(os.getenv("THYNKPDF_ACCESS_TTL", "900"))
    refresh_ttl = int(os.getenv("THYNKPDF_REFRESH_TTL", "1209600"))
    max_upload = int(os.getenv("THYNKPDF_MAX_UPLOAD_BYTES", str(100 * 1024 * 1024)))
    cors_origins = os.getenv("THYNKPDF_CORS_ORIGINS", "http://localhost:3000").split(",")
settings = Settings()
settings.cookie_secure = os.getenv("THYNKPDF_COOKIE_SECURE", "false").lower() == "true"
settings.ai_provider = os.getenv("THYNKPDF_AI_PROVIDER", "stub")
settings.signing_cert = os.getenv("THYNKPDF_SIGNING_CERT", "")
settings.signing_key = os.getenv("THYNKPDF_SIGNING_KEY", "")
settings.signing_key_pass = os.getenv("THYNKPDF_SIGNING_KEY_PASSPHRASE", "")
settings.signing_cert_trusted = os.getenv("THYNKPDF_SIGNING_CERT_TRUSTED", "false").lower() == "true"
settings.cookie_samesite = os.getenv("THYNKPDF_COOKIE_SAMESITE", "strict").lower()
settings.ai_rate_per_min = int(os.getenv("THYNKPDF_AI_RATE_PER_MIN", "20"))
settings.ai_external_base_url = os.getenv("THYNKPDF_AI_EXTERNAL_BASE_URL", "")
settings.ai_external_api_key = os.getenv("THYNKPDF_AI_EXTERNAL_API_KEY", "")
settings.ai_external_model = os.getenv("THYNKPDF_AI_EXTERNAL_MODEL", "")
settings.ai_max_context_chars = int(os.getenv("THYNKPDF_AI_MAX_CONTEXT_CHARS", "12000"))
