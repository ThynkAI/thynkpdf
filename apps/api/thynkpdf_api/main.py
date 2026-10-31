import hashlib, json, time, re
from typing import Literal
import bcrypt, jwt
from fastapi import FastAPI, Depends, Request, UploadFile, File, Form, Header, Cookie
from types import SimpleNamespace
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
import thynkpdf_engine as eng
from thynkpdf_storage import LocalStorage, tenant_key
from .config import settings
from .db import make_session_factory, User, Organization, Membership, Document, DocumentVersion, AuditEvent, Job, RevokedToken, ShareGrant, DocumentTag, uid
from . import schemas as S

ROLE_RANK = {"viewer": 0, "member": 1, "admin": 2, "owner": 3}


class ApiError(Exception):
    def __init__(self, status, code, message, details=None):
        self.status, self.code, self.message, self.details = status, code, message, details or {}


class ErrorBody(BaseModel):
    code: str; message: str; details: dict = {}
class ErrorResponse(BaseModel):
    error: ErrorBody


def create_app(database_url=None, storage_root=None) -> FastAPI:
    app = FastAPI(title="THYNKPDF API", version="0.1.0",
                  responses={400: {"model": ErrorResponse}, 401: {"model": ErrorResponse}, 403: {"model": ErrorResponse},
                             404: {"model": ErrorResponse}, 409: {"model": ErrorResponse}, 413: {"model": ErrorResponse},
                             415: {"model": ErrorResponse}, 422: {"model": ErrorResponse}})
    app.add_middleware(CORSMiddleware, allow_origins=settings.cors_origins, allow_credentials=True,
                       allow_methods=["*"], allow_headers=["*"],
                       expose_headers=["Content-Range", "Accept-Ranges", "Content-Length", "ETag", "X-Document-Version"])
    SessionF = make_session_factory(database_url or settings.database_url)
    store = LocalStorage(storage_root or settings.storage_root)
    app.state.sessions, app.state.storage = SessionF, store

    @app.exception_handler(ApiError)
    async def _api(_, e: ApiError):
        return JSONResponse({"error": {"code": e.code, "message": e.message, "details": e.details}}, status_code=e.status)

    @app.exception_handler(eng.EngineError)
    async def _eng(_, e: eng.EngineError):
        st = {"PDF_MALFORMED": 422, "INVALID_FILE_TYPE": 415, "PDF_ENCRYPTED": 422, "EDIT_NOT_SUPPORTED": 422,
              "TEXT_NOT_FOUND": 422, "EDIT_UNSUPPORTED_CHARACTERS": 422, "EDIT_UNSUPPORTED_FONT": 422,
              "FORM_FIELD_NOT_FOUND": 422, "FORM_FIELD_EXISTS": 409, "SIGNATURE_INVALID": 422, "ANNOTATION_NOT_FOUND": 404, "VALIDATION_ERROR": 422}.get(e.code, 400)
        return JSONResponse({"error": {"code": e.code, "message": e.message, "details": e.details}}, status_code=st)

    from fastapi.exceptions import RequestValidationError
    @app.exception_handler(RequestValidationError)
    async def _val(_, e):
        return JSONResponse({"error": {"code": "VALIDATION_ERROR", "message": "Invalid request",
                                       "details": {"errors": [{"loc": list(x["loc"]), "msg": x["msg"]} for x in e.errors()]}}}, status_code=422)

    @app.exception_handler(Exception)
    async def _any(_, e):  # never leak internals
        return JSONResponse({"error": {"code": "INTERNAL_ERROR", "message": "Internal error", "details": {}}}, status_code=500)

    def db():
        s = SessionF()
        try: yield s
        finally: s.close()

    def audit(s, org, user, action, target=None):
        s.add(AuditEvent(org_id=org, user_id=user, action=action, target=target))

    # ---------------- auth ----------------
    REFRESH_COOKIE = "thynkpdf_refresh"

    def set_refresh_cookie(resp: Response, tok: str):
        resp.set_cookie(REFRESH_COOKIE, tok, max_age=settings.refresh_ttl, httponly=True, samesite="lax",
                        secure=settings.cookie_secure, path="/auth")

    def tokens(user_id, org_id, resp: Response | None = None):
        t = int(time.time())
        mk = lambda typ, ttl: jwt.encode({"sub": user_id, "org": org_id, "typ": typ, "iat": t, "exp": t + ttl, "jti": uid()},
                                         settings.jwt_secret, algorithm="HS256")
        out = {"access_token": mk("access", settings.access_ttl), "refresh_token": mk("refresh", settings.refresh_ttl),
               "token_type": "bearer", "expires_in": settings.access_ttl}
        if resp is not None: set_refresh_cookie(resp, out["refresh_token"])
        return out

    bearer = HTTPBearer(auto_error=False)

    class Principal(BaseModel):
        user_id: str; org_id: str; role: str

    def principal(cred: HTTPAuthorizationCredentials | None = Depends(bearer), s=Depends(db)) -> Principal:
        if cred is None: raise ApiError(401, "AUTH_REQUIRED", "Bearer token required")
        try:
            c = jwt.decode(cred.credentials, settings.jwt_secret, algorithms=["HS256"])
        except jwt.ExpiredSignatureError: raise ApiError(401, "TOKEN_EXPIRED", "Access token expired")
        except jwt.PyJWTError: raise ApiError(401, "TOKEN_INVALID", "Invalid token")
        if c.get("typ") != "access": raise ApiError(401, "TOKEN_INVALID", "Not an access token")
        m = s.scalar(select(Membership).where(Membership.user_id == c["sub"], Membership.org_id == c["org"]))
        if not m: raise ApiError(403, "NOT_A_MEMBER", "Membership revoked")
        if s.get(Organization, c["org"]).suspended: raise ApiError(403, "ORG_SUSPENDED", "Organization suspended")
        return Principal(user_id=c["sub"], org_id=c["org"], role=m.role)

    def need(p: Principal, role: str):
        if ROLE_RANK[p.role] < ROLE_RANK[role]: raise ApiError(403, "FORBIDDEN_ROLE", f"Requires role >= {role}")

    class RegisterIn(BaseModel):
        email: EmailStr; password: str = Field(min_length=10, max_length=128); org_name: str = Field(min_length=1, max_length=200)
    class LoginIn(BaseModel):
        email: EmailStr; password: str; org_id: str | None = None
    class RefreshIn(BaseModel):
        refresh_token: str | None = None
    class TokenOut(BaseModel):
        access_token: str; refresh_token: str; token_type: str; expires_in: int

    @app.post("/auth/register", response_model=TokenOut, status_code=201, tags=["auth"])
    def register(b: RegisterIn, response: Response, s=Depends(db)):
        if s.scalar(select(User).where(User.email == b.email.lower())): raise ApiError(409, "EMAIL_TAKEN", "Email already registered")
        u = User(email=b.email.lower(), password_hash=bcrypt.hashpw(b.password.encode(), bcrypt.gensalt()).decode())
        o = Organization(name=b.org_name); s.add_all([u, o]); s.flush()
        s.add(Membership(org_id=o.id, user_id=u.id, role="owner")); audit(s, o.id, u.id, "auth.register"); s.commit()
        return tokens(u.id, o.id, response)

    @app.post("/auth/login", response_model=TokenOut, tags=["auth"])
    def login(b: LoginIn, response: Response, s=Depends(db)):
        u = s.scalar(select(User).where(User.email == b.email.lower()))
        if not u or not bcrypt.checkpw(b.password.encode(), u.password_hash.encode()):
            raise ApiError(401, "INVALID_CREDENTIALS", "Invalid email or password")
        q = select(Membership).where(Membership.user_id == u.id)
        if b.org_id: q = q.where(Membership.org_id == b.org_id)
        m = s.scalars(q).first()
        if not m: raise ApiError(403, "NOT_A_MEMBER", "No membership for this organization")
        audit(s, m.org_id, u.id, "auth.login"); s.commit()
        return tokens(u.id, m.org_id, response)

    def _read_refresh(s, b, cookie):
        tok = (b.refresh_token if b else None) or cookie
        if not tok: raise ApiError(401, "AUTH_REQUIRED", "Refresh token required (body or httpOnly cookie)")
        try: c = jwt.decode(tok, settings.jwt_secret, algorithms=["HS256"])
        except jwt.ExpiredSignatureError: raise ApiError(401, "TOKEN_EXPIRED", "Refresh token expired")
        except jwt.PyJWTError: raise ApiError(401, "TOKEN_INVALID", "Invalid refresh token")
        if c.get("typ") != "refresh": raise ApiError(401, "TOKEN_INVALID", "Not a refresh token")
        if s.get(RevokedToken, c["jti"]): raise ApiError(401, "TOKEN_REVOKED", "Refresh token revoked or already used")
        return c

    def _revoke(s, c):
        from datetime import datetime, timezone
        s.add(RevokedToken(jti=c["jti"], expires_at=datetime.fromtimestamp(c["exp"], timezone.utc)))

    @app.post("/auth/logout", status_code=204, tags=["auth"])
    def logout(response: Response, b: RefreshIn | None = None, thynkpdf_refresh: str | None = Cookie(None), s=Depends(db)):
        """Revokes the refresh token (cookie or body) and clears the cookie. Idempotent."""
        try:
            c = _read_refresh(s, b, thynkpdf_refresh); _revoke(s, c); audit(s, c["org"], c["sub"], "auth.logout"); s.commit()
        except ApiError: pass
        response.delete_cookie(REFRESH_COOKIE, path="/auth", httponly=True, samesite="lax", secure=settings.cookie_secure)
        response.status_code = 204
        return response

    @app.post("/auth/refresh", response_model=TokenOut, tags=["auth"])
    def refresh(response: Response, b: RefreshIn | None = None, thynkpdf_refresh: str | None = Cookie(None), s=Depends(db)):
        """Rotating refresh: each refresh token is single-use (replay -> TOKEN_REVOKED)."""
        c = _read_refresh(s, b, thynkpdf_refresh)
        if not s.scalar(select(Membership).where(Membership.user_id == c["sub"], Membership.org_id == c["org"])):
            raise ApiError(403, "NOT_A_MEMBER", "Membership revoked")
        _revoke(s, c); s.commit()
        return tokens(c["sub"], c["org"], response)

    @app.get("/auth/me", tags=["auth"])
    def me(p: Principal = Depends(principal)): return p.model_dump()

    class MemberIn(BaseModel):
        email: EmailStr; password: str = Field(min_length=10, max_length=128); role: Literal["admin", "member", "viewer"]

    @app.post("/orgs/members", status_code=201, tags=["orgs"])
    def add_member(b: MemberIn, p: Principal = Depends(principal), s=Depends(db)):
        """Dev-stage invite: creates (or attaches) a user with a role in the caller's org. Admin+."""
        need(p, "admin")
        u = s.scalar(select(User).where(User.email == b.email.lower()))
        if not u:
            u = User(email=b.email.lower(), password_hash=bcrypt.hashpw(b.password.encode(), bcrypt.gensalt()).decode()); s.add(u); s.flush()
        try:
            s.add(Membership(org_id=p.org_id, user_id=u.id, role=b.role)); audit(s, p.org_id, p.user_id, "org.member_add", u.id); s.commit()
        except IntegrityError: raise ApiError(409, "ALREADY_MEMBER", "User already a member")
        return {"user_id": u.id, "role": b.role}

    # ---------------- documents ----------------
    class VersionOut(BaseModel):
        version_id: str; number: int; sha256: str; size: int; operation: str; parent_version_id: str | None; created_at: str
    class DocumentOut(BaseModel):
        document_id: str; filename: str; current_version: int; version_id: str; created_at: str
        folder_id: str | None = None; tags: list[str] = []; visibility: str = "org"; created_by: str | None = None
        deleted_at: str | None = None
    class UploadOut(BaseModel):
        document_id: str; version_id: str; version: int; sha256: str; size: int; page_count: int; filename: str

    def vout(v): return VersionOut(version_id=v.id, number=v.number, sha256=v.sha256, size=v.size, operation=v.operation,
                                   parent_version_id=v.parent_version_id, created_at=v.created_at.isoformat())

    def grant_of(s, p, d):
        return s.scalar(select(ShareGrant).where(ShareGrant.document_id == d.id, ShareGrant.user_id == p.user_id, ShareGrant.org_id == p.org_id))

    def can_read(s, p, d):
        return d.visibility == "org" or ROLE_RANK[p.role] >= ROLE_RANK["admin"] or d.created_by == p.user_id or grant_of(s, p, d) is not None

    def can_write(s, p, d):
        if ROLE_RANK[p.role] < ROLE_RANK["member"]:
            g = grant_of(s, p, d); return g is not None and g.permission == "edit" and d.visibility == "restricted"
        if d.visibility == "org" or ROLE_RANK[p.role] >= ROLE_RANK["admin"] or d.created_by == p.user_id: return True
        g = grant_of(s, p, d); return g is not None and g.permission == "edit"

    def get_doc(s, p: Principal, doc_id: str, include_deleted=False) -> Document:
        q = select(Document).where(Document.id == doc_id, Document.org_id == p.org_id)
        if not include_deleted: q = q.where(Document.deleted_at.is_(None))
        d = s.scalar(q)
        if not d or not can_read(s, p, d): raise ApiError(404, "DOCUMENT_NOT_FOUND", "Document not found")  # same for other-tenant/restricted
        return d

    def visible_filter(p):
        from sqlalchemy import or_, exists
        if ROLE_RANK[p.role] >= ROLE_RANK["admin"]: return Document.org_id == p.org_id
        return (Document.org_id == p.org_id) & or_(Document.visibility == "org", Document.created_by == p.user_id,
                exists().where(ShareGrant.document_id == Document.id, ShareGrant.user_id == p.user_id))

    def get_ver(s, d: Document, number=None, version_id=None) -> DocumentVersion:
        q = select(DocumentVersion).where(DocumentVersion.document_id == d.id, DocumentVersion.org_id == d.org_id)
        q = q.where(DocumentVersion.id == version_id) if version_id else q.where(DocumentVersion.number == (number or d.current_version))
        v = s.scalar(q)
        if not v: raise ApiError(404, "VERSION_NOT_FOUND", "Version not found")
        return v

    def load(d, v): return store.get(v.storage_key)

    def safe_name(n: str) -> str:
        n = re.split(r"[\\/]", n or "")[-1]
        n = re.sub(r"[^A-Za-z0-9._ -]", "_", n).strip(" .")[:200]
        return n or "document.pdf"

    def new_document(s, p, filename, data, op, params=None) -> tuple[Document, DocumentVersion]:
        d = Document(org_id=p.org_id, filename=safe_name(filename), current_version=1, created_by=p.user_id); s.add(d); s.flush()
        v = _store_version(s, p, d, data, 1, op, params, None); s.commit(); return d, v

    def _store_version(s, p, d, data, number, op, params, parent):
        vid = uid(); key = tenant_key(p.org_id, d.id, vid)
        sha = store.put(key, data)
        v = DocumentVersion(id=vid, org_id=p.org_id, document_id=d.id, number=number, sha256=sha, size=len(data),
                            storage_key=key, operation=op, operation_params=json.dumps(params or {}), parent_version_id=parent,
                            created_by=p.user_id)
        s.add(v); audit(s, p.org_id, p.user_id, f"document.{op}", d.id); return v

    def new_version(s, p, d: Document, expected: int, data: bytes, op, params) -> DocumentVersion:
        """Optimistic concurrency: compare-and-swap on documents.current_version + unique(document_id, number)."""
        if expected != d.current_version:
            raise ApiError(409, "VERSION_CONFLICT", "Document changed since expected_version", {"current_version": d.current_version})
        eng.open_pdf(data)  # verify output re-opens before committing
        parent = get_ver(s, d).id
        from sqlalchemy import update
        r = s.execute(update(Document).where(Document.id == d.id, Document.current_version == expected).values(current_version=expected + 1))
        if r.rowcount != 1:
            s.rollback(); raise ApiError(409, "VERSION_CONFLICT", "Concurrent modification", {})
        v = _store_version(s, p, d, data, expected + 1, op, params, parent)
        try: s.commit()
        except IntegrityError:
            s.rollback(); raise ApiError(409, "VERSION_CONFLICT", "Concurrent modification", {})
        return v

    @app.post("/documents/upload", response_model=UploadOut, status_code=201, tags=["documents"])
    async def upload(request: Request, file: UploadFile = File(...), p: Principal = Depends(principal), s=Depends(db)):
        need(p, "member")
        cl = request.headers.get("content-length")
        if cl and int(cl) > settings.max_upload + 64 * 1024:
            raise ApiError(413, "FILE_TOO_LARGE", "Upload exceeds size limit", {"max_bytes": settings.max_upload})
        buf = bytearray()
        while chunk := await file.read(1 << 20):
            buf += chunk
            if len(buf) > settings.max_upload:
                raise ApiError(413, "FILE_TOO_LARGE", "Upload exceeds size limit", {"max_bytes": settings.max_upload})
        data = bytes(buf)
        if not data.startswith(b"%PDF-"): raise ApiError(415, "INVALID_FILE_TYPE", "File is not a PDF (magic bytes)")
        pdf = eng.open_pdf(data)
        d, v = new_document(s, p, file.filename, data, "upload")
        return UploadOut(document_id=d.id, version_id=v.id, version=1, sha256=v.sha256, size=v.size, filename=d.filename, page_count=len(pdf.pages))

    def dout(s, d): return DocumentOut(document_id=d.id, filename=d.filename, current_version=d.current_version,
                                       version_id=get_ver(s, d).id, created_at=d.created_at.isoformat(), folder_id=d.folder_id,
                                       tags=sorted(s.scalars(select(DocumentTag.tag).where(DocumentTag.document_id == d.id))),
                                       visibility=d.visibility, created_by=d.created_by,
                                       deleted_at=d.deleted_at.isoformat() if d.deleted_at else None)

    @app.get("/documents", response_model=list[DocumentOut], tags=["documents"])
    def list_docs(limit: int = 50, offset: int = 0, folder_id: str | None = None, tag: str | None = None, q: str | None = None,
                  p: Principal = Depends(principal), s=Depends(db)):
        """Active documents visible to the caller. folder_id="root" lists unfiled documents."""
        qq = select(Document).where(visible_filter(p), Document.deleted_at.is_(None))
        if folder_id: qq = qq.where(Document.folder_id.is_(None) if folder_id == "root" else Document.folder_id == folder_id)
        if tag: qq = qq.where(Document.id.in_(select(DocumentTag.document_id).where(DocumentTag.tag == tag.lower(), DocumentTag.org_id == p.org_id)))
        if q: qq = qq.where(Document.filename.ilike(f"%{q.replace('%', '').replace('_', '')}%"))
        ds = s.scalars(qq.order_by(Document.created_at.desc()).limit(min(limit, 200)).offset(offset))
        return [dout(s, d) for d in ds]

    @app.get("/documents/{doc_id}", response_model=DocumentOut, tags=["documents"])
    def get_document(doc_id: str, p: Principal = Depends(principal), s=Depends(db)):
        return dout(s, get_doc(s, p, doc_id))

    @app.get("/documents/{doc_id}/versions", response_model=list[VersionOut], tags=["documents"])
    def versions(doc_id: str, p: Principal = Depends(principal), s=Depends(db)):
        d = get_doc(s, p, doc_id)
        return [vout(v) for v in s.scalars(select(DocumentVersion).where(DocumentVersion.document_id == d.id,
                DocumentVersion.org_id == p.org_id).order_by(DocumentVersion.number))]

    def stream_file(request, d, v):
        data = store.get(v.storage_key); n = len(data)
        hdr = {"Accept-Ranges": "bytes", "ETag": f'"{v.sha256}"', "X-Document-Version": str(v.number),
               "Content-Disposition": f'attachment; filename="{d.filename}"'}
        rng = request.headers.get("range")
        if rng:
            m = re.fullmatch(r"bytes=(\d*)-(\d*)", rng.strip())
            if not m or (m[1] == "" and m[2] == ""):
                return Response(status_code=416, headers={"Content-Range": f"bytes */{n}"})
            if m[1] == "": start, end = max(0, n - int(m[2])), n - 1
            else: start, end = int(m[1]), min(int(m[2]) if m[2] else n - 1, n - 1)
            if start >= n or start > end: return Response(status_code=416, headers={"Content-Range": f"bytes */{n}"})
            hdr["Content-Range"] = f"bytes {start}-{end}/{n}"
            return Response(data[start:end + 1], status_code=206, media_type="application/pdf", headers=hdr)
        return Response(data, media_type="application/pdf", headers=hdr)

    @app.get("/documents/{doc_id}/versions/{version_id}/file", tags=["documents"],
             responses={200: {"content": {"application/pdf": {}}}, 206: {"content": {"application/pdf": {}}}})
    def download_version(doc_id: str, version_id: str, request: Request, p: Principal = Depends(principal), s=Depends(db)):
        d = get_doc(s, p, doc_id); return stream_file(request, d, get_ver(s, d, version_id=version_id))

    @app.get("/documents/{doc_id}/download", tags=["documents"], responses={200: {"content": {"application/pdf": {}}}})
    def download_current(doc_id: str, request: Request, p: Principal = Depends(principal), s=Depends(db)):
        d = get_doc(s, p, doc_id); return stream_file(request, d, get_ver(s, d))

    # ---------------- pdf ----------------
    @app.get("/pdf/{doc_id}/metadata", response_model=S.MetadataOut, tags=["pdf"])
    def metadata(doc_id: str, version: int | None = None, p: Principal = Depends(principal), s=Depends(db)):
        d = get_doc(s, p, doc_id); v = get_ver(s, d, number=version)
        return {"document_id": d.id, "version": v.number, "version_id": v.id, **eng.inspect(load(d, v))}

    @app.get("/pdf/{doc_id}/capabilities", response_model=S.CapabilitiesOut, tags=["pdf"])
    def caps(doc_id: str, p: Principal = Depends(principal), s=Depends(db)):
        d = get_doc(s, p, doc_id); v = get_ver(s, d)
        c = eng.capabilities(load(d, v))
        if p.role == "viewer": c["document_limitations"].append({"code": "ROLE_READ_ONLY", "message": "Viewer role cannot modify"})
        return {"document_id": d.id, "version": v.number, "version_id": v.id, **c}

    class VersionedOp(BaseModel):
        document_id: str; expected_version: int = Field(ge=1)
    class RotateIn(VersionedOp):
        pages: list[int] | None = None; angle: Literal[90, 180, 270, -90]
    class ReorderIn(VersionedOp):
        order: list[int]
    class ExtractIn(BaseModel):
        document_id: str; pages: list[int] = Field(min_length=1); filename: str | None = None
    class MergeIn(BaseModel):
        document_ids: list[str] = Field(min_length=2, max_length=50); filename: str = "merged.pdf"
    class SplitIn(BaseModel):
        document_id: str; ranges: list[list[int]] = Field(min_length=1, max_length=100)
    class EditOp(BaseModel):
        op: Literal["text_replace", "text_insert", "text_delete", "text_move", "image_replace", "image_move", "font_change", "link_change"]
        page: int = Field(ge=1)
        object_id: str | None = None
        bbox: list[float] | None = None
        find: str | None = None
        replacement: str | None = None
        text: str | None = Field(None, description="text_insert: text to add")
        x: float | None = None; y: float | None = None
        dx: float | None = None; dy: float | None = None
        font: str = "Helvetica"; font_size: float = 12
        occurrence: Literal["first", "all"] = "all"
        formatting: dict | None = None
    class EditIn(VersionedOp):
        operations: list[EditOp] = Field(min_length=1, max_length=100)
        revision_note: str | None = None
    class VersionResult(BaseModel):
        document_id: str; version_id: str; version: int; sha256: str; size: int; report: dict = {}
    class CompressIn(VersionedOp):
        preset: Literal["low", "balanced", "high"] = "balanced"; strip_metadata: bool = False

    def vres(d, v, report=None): return VersionResult(document_id=d.id, version_id=v.id, version=v.number, sha256=v.sha256, size=v.size, report=report or {})

    def writable(s, p, doc_id, allow_signed=False):
        d = get_doc(s, p, doc_id)
        if not can_write(s, p, d): need(p, "member"); raise ApiError(403, "FORBIDDEN_SHARE", "No edit permission on this document")
        data = load(d, get_ver(s, d))
        if not allow_signed:
            m = eng.inspect(data)
            if m["has_signatures"]:
                raise ApiError(409, "DOCUMENT_SIGNED", "Document carries digital signatures; modifying it would invalidate them",
                               {"safe_options": ["extract pages to a new document", "roll back to an unsigned version"]})
        return d, data

    @app.post("/pdf/pages/rotate", response_model=VersionResult, tags=["pdf"])
    def rotate(b: RotateIn, p: Principal = Depends(principal), s=Depends(db)):
        d, data = writable(s, p, b.document_id)
        return vres(d, new_version(s, p, d, b.expected_version, eng.rotate(data, b.pages, b.angle), "rotate", b.model_dump()))

    @app.post("/pdf/pages/reorder", response_model=VersionResult, tags=["pdf"])
    def reorder(b: ReorderIn, p: Principal = Depends(principal), s=Depends(db)):
        d, data = writable(s, p, b.document_id)
        return vres(d, new_version(s, p, d, b.expected_version, eng.reorder(data, b.order), "reorder", b.model_dump()))

    @app.post("/pdf/pages/extract", response_model=UploadOut, status_code=201, tags=["pdf"])
    def extract(b: ExtractIn, p: Principal = Depends(principal), s=Depends(db)):
        d, data = writable(s, p, b.document_id, allow_signed=True); out = eng.extract(data, b.pages)
        nd, v = new_document(s, p, b.filename or f"extract-{d.filename}", out, "extract", b.model_dump())
        return UploadOut(document_id=nd.id, version_id=v.id, version=1, sha256=v.sha256, size=v.size, filename=nd.filename, page_count=len(b.pages))

    @app.post("/pdf/merge", response_model=UploadOut, status_code=201, tags=["pdf"])
    def merge(b: MergeIn, p: Principal = Depends(principal), s=Depends(db)):
        datas = [writable(s, p, i, allow_signed=True)[1] for i in b.document_ids]; out = eng.merge(datas)
        nd, v = new_document(s, p, b.filename, out, "merge", b.model_dump())
        return UploadOut(document_id=nd.id, version_id=v.id, version=1, sha256=v.sha256, size=v.size, filename=nd.filename, page_count=len(eng.open_pdf(out).pages))

    @app.post("/pdf/split", response_model=list[UploadOut], status_code=201, tags=["pdf"])
    def split(b: SplitIn, p: Principal = Depends(principal), s=Depends(db)):
        d, data = writable(s, p, b.document_id, allow_signed=True); res = []
        for i, part in enumerate(eng.split(data, b.ranges)):
            nd, v = new_document(s, p, f"part{i + 1}-{d.filename}", part, "split", {"range": b.ranges[i]})
            res.append(UploadOut(document_id=nd.id, version_id=v.id, version=1, sha256=v.sha256, size=v.size, filename=nd.filename, page_count=b.ranges[i][1] - b.ranges[i][0] + 1))
        return res

    @app.post("/pdf/edit", response_model=VersionResult, tags=["pdf"])
    def edit(b: EditIn, p: Principal = Depends(principal), s=Depends(db)):
        d, data = writable(s, p, b.document_id); applied = []
        for o in b.operations:
            req = {"text_replace": ("find", "replacement"), "text_delete": ("find",), "text_move": ("find", "dx", "dy"),
                   "text_insert": ("text", "x", "y")}
            if o.op not in req:
                raise ApiError(422, "EDIT_OP_NOT_IMPLEMENTED", f"Operation {o.op} not implemented yet", {"supported_ops": list(req)})
            missing = [f for f in req[o.op] if getattr(o, f) in (None, "") and not (o.op == "text_replace" and f == "replacement" and o.replacement == "")]
            if missing: raise ApiError(422, "VALIDATION_ERROR", f"{o.op} requires {missing}")
            if o.op == "text_replace": data, n = eng.replace_text(data, o.page, o.find, o.replacement, o.occurrence)
            elif o.op == "text_delete": data, n = eng.delete_text(data, o.page, o.find, o.occurrence)
            elif o.op == "text_move": data, n = eng.move_text(data, o.page, o.find, o.dx, o.dy)
            else: data, n = eng.insert_text(data, o.page, o.text, o.x, o.y, o.font_size, o.font), 1
            applied.append({"op": o.op, "page": o.page, "count": n})
        v = new_version(s, p, d, b.expected_version, data, "edit", b.model_dump())
        return vres(d, v, {"applied": applied, "method": "content_stream_rewrite"})

    @app.post("/pdf/compress", response_model=VersionResult, tags=["pdf"])
    def compress(b: CompressIn, p: Principal = Depends(principal), s=Depends(db)):
        d, data = writable(s, p, b.document_id); out, rep = eng.compress(data, b.preset, b.strip_metadata)
        if out == data:
            if b.expected_version != d.current_version:
                raise ApiError(409, "VERSION_CONFLICT", "Document changed", {"current_version": d.current_version})
            v = get_ver(s, d); return vres(d, v, {**rep, "new_version_created": False})
        return vres(d, new_version(s, p, d, b.expected_version, out, "compress", b.model_dump()), {**rep, "new_version_created": True})

    @app.get("/jobs/{job_id}", tags=["jobs"])
    def job(job_id: str, p: Principal = Depends(principal), s=Depends(db)):
        j = s.scalar(select(Job).where(Job.id == job_id, Job.org_id == p.org_id))
        if not j: raise ApiError(404, "JOB_NOT_FOUND", "Job not found")
        return {"job_id": j.id, "kind": j.kind, "status": j.status, "progress": j.progress,
                "result": json.loads(j.result) if j.result else None, "error_code": j.error_code, "created_at": j.created_at.isoformat()}

    @app.get("/health", tags=["ops"])
    def health(): return {"status": "ok"}

    ctx = SimpleNamespace(**{k: v for k, v in locals().items() if k != "ctx"}, ApiError=ApiError, settings=settings, ROLE_RANK=ROLE_RANK)
    from . import features
    features.register_all(app, ctx)
    return app


app = create_app()
