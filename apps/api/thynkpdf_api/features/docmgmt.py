"""Folders, tags, star, trash (soft delete / restore / permanent purge), share grants (member + link), restore version.
Shapes follow apps/web/docs/frontend-backend-requests.md §5."""
import hashlib, re, secrets
from datetime import datetime, timezone
from typing import Literal
from fastapi import Depends, Request
from fastapi.responses import Response
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy import select, func, update
from ..db import Folder, Document, DocumentTag, DocumentStar, ShareGrant, User, Membership, DocumentVersion, SigningRequest

TAG_RE = re.compile(r"^[a-z0-9][a-z0-9_\-]{0,63}$")


def _now(): return datetime.now(timezone.utc)


def _aware(d): return d if d is None or d.tzinfo else d.replace(tzinfo=timezone.utc)


def register(app, c):
    class FolderIn(BaseModel):
        name: str = Field(min_length=1, max_length=200); parent_id: str | None = None
    class FolderPatch(BaseModel):
        name: str | None = Field(None, min_length=1, max_length=200); parent_id: str | None = Field(None, description='folder id or "root"')
    class FolderOut(BaseModel):
        folder_id: str; name: str; parent_id: str | None; created_at: str
    class DocPatch(BaseModel):
        filename: str | None = Field(None, min_length=1, max_length=200)
        folder_id: str | None = Field(None, description='folder id, or "root" to unfile')
        tags: list[str] | None = Field(None, max_length=50, description="replaces the tag set")
        starred: bool | None = None
        visibility: Literal["org", "restricted"] | None = None
    class ShareIn(BaseModel):
        email: EmailStr | None = Field(None, description="null = public view-only link")
        role: Literal["viewer", "editor"] = "viewer"; expires_at: datetime | None = None
    class ShareOut(BaseModel):
        share_id: str; kind: Literal["user", "link"]; email: str | None; role: str; expires_at: str | None; created_at: str
        url: str | None = Field(None, description="link shares only, returned ONCE at creation")
    class RestoreIn(BaseModel):
        expected_version: int | None = Field(None, ge=1, description="optional optimistic-concurrency check")

    def fout(f): return FolderOut(folder_id=f.id, name=f.name, parent_id=f.parent_id, created_at=f.created_at.isoformat())

    def get_folder(s, p, fid):
        f = s.scalar(select(Folder).where(Folder.id == fid, Folder.org_id == p.org_id))
        if not f: raise c.ApiError(404, "FOLDER_NOT_FOUND", "Folder not found")
        return f

    def manage(s, p, d):
        if not (c.ROLE_RANK[p.role] >= c.ROLE_RANK["admin"] or d.created_by == p.user_id):
            raise c.ApiError(403, "FORBIDDEN_ROLE", "Only the document creator or an admin can do this")

    # ---- folders ----
    @app.post("/folders", response_model=FolderOut, status_code=201, tags=["folders"])
    def create_folder(b: FolderIn, p=Depends(c.principal), s=Depends(c.db)):
        c.need(p, "member")
        if b.parent_id: get_folder(s, p, b.parent_id)
        if s.scalar(select(Folder).where(Folder.org_id == p.org_id, Folder.name == b.name,
                                         Folder.parent_id.is_(None) if b.parent_id is None else Folder.parent_id == b.parent_id)):
            raise c.ApiError(409, "FOLDER_EXISTS", "A folder with this name already exists here")
        f = Folder(org_id=p.org_id, name=b.name, parent_id=b.parent_id, created_by=p.user_id); s.add(f)
        c.audit(s, p.org_id, p.user_id, "folder.create", f.id); s.commit(); return fout(f)

    @app.get("/folders", response_model=list[FolderOut], tags=["folders"])
    def list_folders(p=Depends(c.principal), s=Depends(c.db)):
        return [fout(f) for f in s.scalars(select(Folder).where(Folder.org_id == p.org_id).order_by(Folder.name))]

    @app.patch("/folders/{fid}", response_model=FolderOut, tags=["folders"])
    def patch_folder(fid: str, b: FolderPatch, p=Depends(c.principal), s=Depends(c.db)):
        c.need(p, "member"); f = get_folder(s, p, fid)
        if b.name: f.name = b.name
        if b.parent_id == "root": f.parent_id = None
        elif b.parent_id:
            x = get_folder(s, p, b.parent_id); np_id = x.id
            while x is not None:
                if x.id == f.id: raise c.ApiError(422, "FOLDER_CYCLE", "Folder cannot be moved into itself")
                x = s.get(Folder, x.parent_id) if x.parent_id else None
            f.parent_id = np_id
        c.audit(s, p.org_id, p.user_id, "folder.update", f.id); s.commit(); return fout(f)

    @app.delete("/folders/{fid}", status_code=204, tags=["folders"])
    def delete_folder(fid: str, p=Depends(c.principal), s=Depends(c.db)):
        c.need(p, "member"); f = get_folder(s, p, fid)
        if s.scalar(select(func.count()).select_from(Document).where(Document.folder_id == f.id, Document.purged_at.is_(None))) or \
           s.scalar(select(func.count()).select_from(Folder).where(Folder.parent_id == f.id)):
            raise c.ApiError(409, "FOLDER_NOT_EMPTY", "Folder contains documents (incl. trashed) or subfolders")
        s.execute(update(Document).where(Document.folder_id == f.id).values(folder_id=None))  # purged leftovers
        s.delete(f); c.audit(s, p.org_id, p.user_id, "folder.delete", fid); s.commit()

    # ---- document metadata / tags / star ----
    @app.patch("/documents/{doc_id}", response_model=c.DocumentOut, tags=["documents"])
    def patch_doc(doc_id: str, b: DocPatch, p=Depends(c.principal), s=Depends(c.db)):
        d = c.get_doc(s, p, doc_id)
        if b.starred is not None:  # personal flag: allowed for any reader, including viewers
            st = s.scalar(select(DocumentStar).where(DocumentStar.document_id == d.id, DocumentStar.user_id == p.user_id))
            if b.starred and not st: s.add(DocumentStar(org_id=p.org_id, document_id=d.id, user_id=p.user_id))
            if not b.starred and st: s.delete(st)
        if any(x is not None for x in (b.filename, b.folder_id, b.tags, b.visibility)):
            d, _ = c.writable(s, p, doc_id, allow_signed=True)
            if b.filename: d.filename = c.safe_name(b.filename)
            if b.folder_id: d.folder_id = None if b.folder_id == "root" else get_folder(s, p, b.folder_id).id
            if b.visibility and b.visibility != d.visibility: manage(s, p, d); d.visibility = b.visibility
            if b.tags is not None:
                tags = sorted({t.strip().lower() for t in b.tags})
                bad = [t for t in tags if not TAG_RE.match(t)]
                if bad: raise c.ApiError(422, "VALIDATION_ERROR", "Invalid tags (a-z0-9_-, max 64)", {"tags": bad})
                for t in s.scalars(select(DocumentTag).where(DocumentTag.document_id == d.id)): s.delete(t)
                s.flush()
                for t in tags: s.add(DocumentTag(org_id=p.org_id, document_id=d.id, tag=t))
            d.updated_at = _now()
            c.audit(s, p.org_id, p.user_id, "document.update", d.id, document_id=d.id, details=b.model_dump(exclude_none=True, exclude={"starred"}))
        s.commit(); return c.dout(s, d, p)

    @app.get("/tags", response_model=list[str], tags=["documents"])
    def tags(p=Depends(c.principal), s=Depends(c.db)):
        return list(s.scalars(select(DocumentTag.tag).where(DocumentTag.org_id == p.org_id).distinct().order_by(DocumentTag.tag)))

    # ---- trash / purge ----
    @app.delete("/documents/{doc_id}", response_model=c.DocumentOut, tags=["documents"],
                responses={204: {"description": "permanently deleted (permanent=true)"}})
    def trash(doc_id: str, request: Request, permanent: bool = False, p=Depends(c.principal), s=Depends(c.db)):
        """Default: move to trash (restorable). permanent=true: only for documents already in trash; deletes all stored
        version bytes irreversibly (metadata + audit rows are kept). Blocked while a signature request is pending."""
        d = c.get_doc(s, p, doc_id, include_deleted=True); c.need(p, "member"); manage(s, p, d)
        if not permanent:
            if d.deleted_at: raise c.ApiError(409, "ALREADY_IN_TRASH", "Document is already in trash")
            d.deleted_at, d.deleted_by = _now(), p.user_id
            c.audit(s, p.org_id, p.user_id, "document.trash", d.id, document_id=d.id, request=request); s.commit(); return c.dout(s, d, p)
        if not d.deleted_at: raise c.ApiError(409, "NOT_IN_TRASH", "Move to trash before permanent deletion")
        if s.scalar(select(SigningRequest.id).where(SigningRequest.document_id == d.id, SigningRequest.status.in_(["pending", "needs_attention"]))):
            raise c.ApiError(409, "SIGNING_IN_PROGRESS", "Cancel pending signature requests first")
        vs = list(s.scalars(select(DocumentVersion).where(DocumentVersion.document_id == d.id)))
        d.purged_at = _now()
        c.audit(s, p.org_id, p.user_id, "document.purge", d.id, document_id=d.id, request=request,
                details={"versions": len(vs), "sha256": [v.sha256 for v in vs]})
        s.commit()
        for v in vs: c.store.delete(v.storage_key)  # after commit: DB never points at missing bytes for live docs
        return Response(status_code=204)

    @app.post("/documents/{doc_id}/restore", response_model=c.DocumentOut, tags=["documents"])
    def restore(doc_id: str, p=Depends(c.principal), s=Depends(c.db)):
        d = c.get_doc(s, p, doc_id, include_deleted=True); c.need(p, "member"); manage(s, p, d)
        if d.deleted_at is None: raise c.ApiError(409, "NOT_IN_TRASH", "Document is not in trash")
        if d.folder_id and not s.get(Folder, d.folder_id): d.folder_id = None
        d.deleted_at = d.deleted_by = None
        c.audit(s, p.org_id, p.user_id, "document.restore", d.id, document_id=d.id); s.commit(); return c.dout(s, d, p)

    # ---- shares ----
    def sout(s, g, url=None):
        u = s.get(User, g.user_id) if g.user_id else None
        return ShareOut(share_id=g.id, kind="user" if g.user_id else "link", email=u.email if u else None,
                        role="editor" if g.permission == "edit" else "viewer",
                        expires_at=_aware(g.expires_at).isoformat() if g.expires_at else None, created_at=g.created_at.isoformat(), url=url)

    @app.get("/documents/{doc_id}/shares", response_model=list[ShareOut], tags=["sharing"])
    def list_shares(doc_id: str, p=Depends(c.principal), s=Depends(c.db)):
        d = c.get_doc(s, p, doc_id)
        return [sout(s, g) for g in s.scalars(select(ShareGrant).where(ShareGrant.document_id == d.id, ShareGrant.org_id == p.org_id))]

    @app.post("/documents/{doc_id}/shares", response_model=ShareOut, status_code=201, tags=["sharing"])
    def share(doc_id: str, b: ShareIn, request: Request, p=Depends(c.principal), s=Depends(c.db)):
        """email → grant to a member of the SAME org (matters for visibility=restricted docs).
        email=null → public read-only link (`url`, returned once). Editor links are not supported."""
        d = c.get_doc(s, p, doc_id); c.need(p, "member"); manage(s, p, d)
        exp = _aware(b.expires_at)
        if exp and exp <= _now(): raise c.ApiError(422, "VALIDATION_ERROR", "expires_at must be in the future")
        perm = "edit" if b.role == "editor" else "view"
        if b.email is None:
            if perm == "edit": raise c.ApiError(422, "LINK_EDITOR_NOT_SUPPORTED", "Public links are view-only")
            tok = secrets.token_urlsafe(32)
            g = ShareGrant(org_id=p.org_id, document_id=d.id, user_id=None, token_hash=hashlib.sha256(tok.encode()).hexdigest(),
                           permission="view", expires_at=exp, created_by=p.user_id)
            s.add(g); c.audit(s, p.org_id, p.user_id, "document.share_link", d.id, document_id=d.id, request=request); s.commit()
            return sout(s, g, url=f"/shared/{tok}")
        u = s.scalar(select(User).where(User.email == b.email.lower()))
        if not u or not s.scalar(select(Membership).where(Membership.user_id == u.id, Membership.org_id == p.org_id)):
            raise c.ApiError(404, "USER_NOT_IN_ORG", "No member of this organization has that email (cross-org sharing not supported)")
        g = s.scalar(select(ShareGrant).where(ShareGrant.document_id == d.id, ShareGrant.user_id == u.id))
        if g: g.permission, g.expires_at = perm, exp
        else: g = ShareGrant(org_id=p.org_id, document_id=d.id, user_id=u.id, permission=perm, expires_at=exp, created_by=p.user_id); s.add(g)
        c.audit(s, p.org_id, p.user_id, "document.share", d.id, document_id=d.id, request=request, details={"email": u.email, "role": b.role}); s.commit()
        return sout(s, g)

    @app.delete("/shares/{share_id}", status_code=204, tags=["sharing"])
    def unshare(share_id: str, p=Depends(c.principal), s=Depends(c.db)):
        g = s.scalar(select(ShareGrant).where(ShareGrant.id == share_id, ShareGrant.org_id == p.org_id))
        if not g: raise c.ApiError(404, "SHARE_NOT_FOUND", "Share not found")
        d = c.get_doc(s, p, g.document_id, include_deleted=True); c.need(p, "member"); manage(s, p, d)
        s.delete(g); c.audit(s, p.org_id, p.user_id, "document.unshare", d.id, document_id=d.id); s.commit()
        return Response(status_code=204)

    class SharedOut(BaseModel):
        filename: str; version: int; size: int; page_count: int | None; expires_at: str | None; file_path: str

    def by_link(s, token):
        g = s.scalar(select(ShareGrant).where(ShareGrant.token_hash == hashlib.sha256(token.encode()).hexdigest()))
        if not g or (g.expires_at and _aware(g.expires_at) <= _now()): raise c.ApiError(404, "SHARE_NOT_FOUND", "Link invalid or expired")
        d = s.get(Document, g.document_id)
        if d is None or d.deleted_at or d.purged_at: raise c.ApiError(404, "SHARE_NOT_FOUND", "Link invalid or expired")
        v = s.scalar(select(DocumentVersion).where(DocumentVersion.document_id == d.id, DocumentVersion.number == d.current_version))
        return g, d, v

    @app.get("/shared/{token}", response_model=SharedOut, tags=["sharing"])
    def shared_meta(token: str, s=Depends(c.db)):
        g, d, v = by_link(s, token)
        return SharedOut(filename=d.filename, version=v.number, size=v.size, page_count=v.page_count,
                         expires_at=_aware(g.expires_at).isoformat() if g.expires_at else None, file_path=f"/shared/{token}/file")

    @app.get("/shared/{token}/file", tags=["sharing"], responses={200: {"content": {"application/pdf": {}}}})
    def shared_file(token: str, request: Request, s=Depends(c.db)):
        g, d, v = by_link(s, token)
        c.audit(s, d.org_id, None, "document.view", d.id, document_id=d.id, actor_email="public-link", version=v.number, request=request,
                details={"share_id": g.id}); s.commit()
        return c.stream_file(request, d, v)

    # ---- restore version ----
    @app.post("/documents/{doc_id}/versions/{version_id}/restore", response_model=c.VersionResult, tags=["documents"])
    def restore_version(doc_id: str, version_id: str, b: RestoreIn | None = None, p=Depends(c.principal), s=Depends(c.db)):
        """Creates a NEW version with the bytes of version_id (history is never rewritten)."""
        d, _ = c.writable(s, p, doc_id, allow_signed=True); tv = c.get_ver(s, d, version_id=version_id)
        expected = b.expected_version if b and b.expected_version else d.current_version
        v = c.new_version(s, p, d, expected, c.store.get(tv.storage_key), "restore_version", {"restored_version": tv.number})
        return c.vres(d, v, {"restored_from_version": tv.number, "restored_sha256": tv.sha256})
