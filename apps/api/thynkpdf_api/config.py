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
