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
