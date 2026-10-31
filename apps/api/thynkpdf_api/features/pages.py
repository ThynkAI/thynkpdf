from typing import Literal
from fastapi import Depends
from pydantic import BaseModel, Field
import thynkpdf_engine as eng


def register(app, c):
    class InsertBlankIn(BaseModel):
        document_id: str; expected_version: int = Field(ge=1)
        after: int = Field(0, ge=0, description="Insert after this page (0 = at start)")
        count: int = Field(1, ge=1, le=100); width: float | None = None; height: float | None = None
    class DeleteIn(BaseModel):
        document_id: str; expected_version: int = Field(ge=1); pages: list[int] = Field(min_length=1)
    class DuplicateIn(BaseModel):
        document_id: str; expected_version: int = Field(ge=1); page: int = Field(ge=1); count: int = Field(1, ge=1, le=100)

    def run(b, p, s, fn, op):
        d, data = c.writable(s, p, b.document_id)
        return c.vres(d, c.new_version(s, p, d, b.expected_version, fn(data), op, b.model_dump()))

    @app.post("/pdf/pages/insert-blank", response_model=c.VersionResult, tags=["pdf"])
    def insert_blank(b: InsertBlankIn, p=Depends(c.principal), s=Depends(c.db)):
        return run(b, p, s, lambda d: eng.insert_blank(d, b.after, b.count, b.width, b.height), "insert_blank")

    @app.post("/pdf/pages/delete", response_model=c.VersionResult, tags=["pdf"])
    def delete(b: DeleteIn, p=Depends(c.principal), s=Depends(c.db)):
        """Destructive within the new version only; previous versions remain downloadable (recovery = rollback)."""
        return run(b, p, s, lambda d: eng.delete_pages(d, b.pages), "delete_pages")

    @app.post("/pdf/pages/duplicate", response_model=c.VersionResult, tags=["pdf"])
    def duplicate(b: DuplicateIn, p=Depends(c.principal), s=Depends(c.db)):
        """Duplicated pages do not copy annotations (documented limitation)."""
        return run(b, p, s, lambda d: eng.duplicate_page(d, b.page, b.count), "duplicate_page")
