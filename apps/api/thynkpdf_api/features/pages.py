from typing import Literal
from fastapi import Depends
from pydantic import BaseModel, Field
import thynkpdf_engine as eng


def register(app, c):
    class InsertBlankIn(BaseModel):
        document_id: str; expected_version: int = Field(ge=1)
        after_page: int = Field(0, ge=0, description="Insert after this page (0 = at start)")
        count: int = Field(1, ge=1, le=100); width: float | None = Field(None, gt=0); height: float | None = Field(None, gt=0)
    class DeleteIn(BaseModel):
        document_id: str; expected_version: int = Field(ge=1); pages: list[int] = Field(min_length=1)
    class DuplicateIn(BaseModel):
        document_id: str; expected_version: int = Field(ge=1); pages: list[int] = Field(min_length=1, max_length=500)
        position: Literal["after_each"] | int = "after_each"
    class InsertFromIn(BaseModel):
        document_id: str; expected_version: int = Field(ge=1); source_document_id: str
        source_pages: list[int] | None = None; after_page: int = Field(ge=0)

    def run(b, p, s, fn, op, d_data=None):
        d, data = d_data or c.writable(s, p, b.document_id)
        return c.vres(d, c.new_version(s, p, d, b.expected_version, fn(data), op, b.model_dump()))

    @app.post("/pdf/pages/insert-blank", response_model=c.VersionResult, tags=["pdf"])
    def insert_blank(b: InsertBlankIn, p=Depends(c.principal), s=Depends(c.db)):
        return run(b, p, s, lambda d: eng.insert_blank(d, b.after_page, b.count, b.width, b.height), "insert_blank")

    @app.post("/pdf/pages/delete", response_model=c.VersionResult, tags=["pdf"])
    def delete(b: DeleteIn, p=Depends(c.principal), s=Depends(c.db)):
        """Previous versions remain downloadable (recovery = restore version). 400 CANNOT_DELETE_ALL_PAGES."""
        return run(b, p, s, lambda d: eng.delete_pages(d, b.pages), "delete_pages")

    @app.post("/pdf/pages/duplicate", response_model=c.VersionResult, tags=["pdf"])
    def duplicate(b: DuplicateIn, p=Depends(c.principal), s=Depends(c.db)):
        """Duplicated pages do not copy annotations (documented limitation)."""
        return run(b, p, s, lambda d: eng.duplicate_pages(d, b.pages, b.position), "duplicate_pages")

    @app.post("/pdf/pages/insert-from", response_model=c.VersionResult, tags=["pdf"])
    def insert_from(b: InsertFromIn, p=Depends(c.principal), s=Depends(c.db)):
        """Inserts pages of another document in the same organization (source is read, never modified)."""
        sd = c.get_doc(s, p, b.source_document_id); src = c.load(sd, c.get_ver(s, sd))
        return run(b, p, s, lambda d: eng.insert_from(d, src, b.source_pages, b.after_page), "insert_from")
