"""Folders, tags, trash (soft delete/restore), share grants, version rollback."""
import re
from datetime import datetime, timezone
from typing import Literal
from fastapi import Depends
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy import select, func
from ..db import Folder, Document, DocumentTag, ShareGrant, User, Membership, DocumentVersion

TAG_RE = re.compile(r"^[a-z0-9][a-z0-9_\-]{0,63}$")


def register(app, c):
    class FolderIn(BaseModel):
        name: str = Field(min_length=1, max_length=200); parent_id: str | None = None
    class FolderPatch(BaseModel):
        name: str | None = Field(None, min_length=1, max_length=200); parent_id: str | None = None; move_to_root: bool = False
    class FolderOut(BaseModel):
        folder_id: str; name: str; parent_id: str | None; created_at: str
    class DocPatch(BaseModel):
        filename: str | None = Field(None, min_length=1, max_length=200)
        folder_id: str | None = Field(None, description='folder id, or "root" to unfile')
        tags: list[str] | None = Field(None, max_length=50, description="replaces the tag set")
        visibility: Literal["org", "restricted"] | None = None
    class ShareIn(BaseModel):
        email: EmailStr; permission: Literal["view", "edit"] = "view"
    class ShareOut(BaseModel):
        grant_id: str; user_id: str; email: str; permission: str; created_at: str
    class RollbackIn(BaseModel):
        expected_version: int = Field(ge=1); target_version: int = Field(ge=1)

    def fout(f): return FolderOut(folder_id=f.id, name=f.name, parent_id=f.parent_id, created_at=f.created_at.isoformat())

    def get_folder(s, p, fid):
        f = s.scalar(select(Folder).where(Folder.id == fid, Folder.org_id == p.org_id))
        if not f: raise c.ApiError(404, "FOLDER_NOT_FOUND", "Folder not found")
        return f

    def check_cycle(s, p, folder, new_parent):
        x = new_parent
        while x is not None:
            if x.id == folder.id: raise c.ApiError(422, "FOLDER_CYCLE", "Folder cannot be moved into itself")
            x = s.get(Folder, x.parent_id) if x.parent_id else None

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
        if b.move_to_root: f.parent_id = None
        elif b.parent_id:
            np = get_folder(s, p, b.parent_id); check_cycle(s, p, f, np); f.parent_id = np.id
        c.audit(s, p.org_id, p.user_id, "folder.update", f.id); s.commit(); return fout(f)

    @app.delete("/folders/{fid}", status_code=204, tags=["folders"])
    def delete_folder(fid: str, p=Depends(c.principal), s=Depends(c.db)):
        c.need(p, "member"); f = get_folder(s, p, fid)
        if s.scalar(select(func.count()).select_from(Document).where(Document.folder_id == f.id)) or \
           s.scalar(select(func.count()).select_from(Folder).where(Folder.parent_id == f.id)):
            raise c.ApiError(409, "FOLDER_NOT_EMPTY", "Folder contains documents (incl. trashed) or subfolders")
        s.delete(f); c.audit(s, p.org_id, p.user_id, "folder.delete", fid); s.commit()

    # ---- document metadata / tags / visibility ----
    @app.patch("/documents/{doc_id}", response_model=c.DocumentOut, tags=["documents"])
    def patch_doc(doc_id: str, b: DocPatch, p=Depends(c.principal), s=Depends(c.db)):
        d, _ = c.writable(s, p, doc_id, allow_signed=True)
        if b.filename: d.filename = c.safe_name(b.filename)
        if b.folder_id: d.folder_id = None if b.folder_id == "root" else get_folder(s, p, b.folder_id).id
        if b.visibility and b.visibility != d.visibility: manage(s, p, d); d.visibility = b.visibility
        if b.tags is not None:
            tags = sorted({t.strip().lower() for t in b.tags})
            bad = [t for t in tags if not TAG_RE.match(t)]
            if bad: raise c.ApiError(422, "VALIDATION_ERROR", "Invalid tags (a-z0-9_- , max 64)", {"tags": bad})
            for t in s.scalars(select(DocumentTag).where(DocumentTag.document_id == d.id)): s.delete(t)
            s.flush()
            for t in tags: s.add(DocumentTag(org_id=p.org_id, document_id=d.id, tag=t))
        c.audit(s, p.org_id, p.user_id, "document.update", d.id); s.commit(); return c.dout(s, d)

    @app.get("/tags", response_model=list[str], tags=["documents"])
    def tags(p=Depends(c.principal), s=Depends(c.db)):
        return list(s.scalars(select(DocumentTag.tag).where(DocumentTag.org_id == p.org_id).distinct().order_by(DocumentTag.tag)))

    # ---- trash ----
    @app.delete("/documents/{doc_id}", response_model=c.DocumentOut, tags=["documents"])
    def trash(doc_id: str, p=Depends(c.principal), s=Depends(c.db)):
        """Soft delete (moves to trash). All versions are retained and restorable. No permanent purge API yet."""
        d, _ = c.writable(s, p, doc_id, allow_signed=True); manage(s, p, d)
        d.deleted_at, d.deleted_by = datetime.now(timezone.utc), p.user_id
        c.audit(s, p.org_id, p.user_id, "document.trash", d.id); s.commit(); return c.dout(s, d)

    @app.get("/documents-trash", response_model=list[c.DocumentOut], tags=["documents"])
    def list_trash(p=Depends(c.principal), s=Depends(c.db)):
        ds = s.scalars(select(Document).where(c.visible_filter(p), Document.deleted_at.is_not(None)).order_by(Document.deleted_at.desc()))
        return [c.dout(s, d) for d in ds]

    @app.post("/documents/{doc_id}/restore", response_model=c.DocumentOut, tags=["documents"])
    def restore(doc_id: str, p=Depends(c.principal), s=Depends(c.db)):
        d = c.get_doc(s, p, doc_id, include_deleted=True); c.need(p, "member"); manage(s, p, d)
        if d.deleted_at is None: raise c.ApiError(409, "NOT_IN_TRASH", "Document is not in trash")
        if d.folder_id and not s.get(Folder, d.folder_id): d.folder_id = None
        d.deleted_at = d.deleted_by = None
        c.audit(s, p.org_id, p.user_id, "document.restore", d.id); s.commit(); return c.dout(s, d)

    # ---- shares ----
    def sout(s, g):
        return ShareOut(grant_id=g.id, user_id=g.user_id, email=s.get(User, g.user_id).email, permission=g.permission, created_at=g.created_at.isoformat())

    @app.get("/documents/{doc_id}/shares", response_model=list[ShareOut], tags=["sharing"])
    def list_shares(doc_id: str, p=Depends(c.principal), s=Depends(c.db)):
        d = c.get_doc(s, p, doc_id)
        return [sout(s, g) for g in s.scalars(select(ShareGrant).where(ShareGrant.document_id == d.id, ShareGrant.org_id == p.org_id))]

    @app.post("/documents/{doc_id}/shares", response_model=ShareOut, status_code=201, tags=["sharing"])
    def share(doc_id: str, b: ShareIn, p=Depends(c.principal), s=Depends(c.db)):
        """Grants a member of the SAME organization access to a restricted document. Cross-org sharing is not supported."""
        d = c.get_doc(s, p, doc_id); c.need(p, "member"); manage(s, p, d)
        u = s.scalar(select(User).where(User.email == b.email.lower()))
        if not u or not s.scalar(select(Membership).where(Membership.user_id == u.id, Membership.org_id == p.org_id)):
            raise c.ApiError(404, "USER_NOT_IN_ORG", "No member of this organization has that email")
        g = s.scalar(select(ShareGrant).where(ShareGrant.document_id == d.id, ShareGrant.user_id == u.id))
        if g: g.permission = b.permission
        else: g = ShareGrant(org_id=p.org_id, document_id=d.id, user_id=u.id, permission=b.permission, created_by=p.user_id); s.add(g)
        c.audit(s, p.org_id, p.user_id, "document.share", d.id); s.commit(); return sout(s, g)

    @app.delete("/documents/{doc_id}/shares/{grant_id}", status_code=204, tags=["sharing"])
    def unshare(doc_id: str, grant_id: str, p=Depends(c.principal), s=Depends(c.db)):
        d = c.get_doc(s, p, doc_id); c.need(p, "member"); manage(s, p, d)
        g = s.scalar(select(ShareGrant).where(ShareGrant.id == grant_id, ShareGrant.document_id == d.id, ShareGrant.org_id == p.org_id))
        if not g: raise c.ApiError(404, "SHARE_NOT_FOUND", "Share grant not found")
        s.delete(g); c.audit(s, p.org_id, p.user_id, "document.unshare", d.id); s.commit()

    # ---- rollback ----
    @app.post("/documents/{doc_id}/rollback", response_model=c.VersionResult, tags=["documents"])
    def rollback(doc_id: str, b: RollbackIn, p=Depends(c.principal), s=Depends(c.db)):
        """Creates a NEW version whose bytes equal target_version (history is never rewritten)."""
        d, _ = c.writable(s, p, doc_id, allow_signed=True); tv = c.get_ver(s, d, number=b.target_version)
        data = c.store.get(tv.storage_key)
        v = c.new_version(s, p, d, b.expected_version, data, "rollback", {"target_version": b.target_version})
        return c.vres(d, v, {"restored_from_version": tv.number, "restored_sha256": tv.sha256})
