from typing import Literal
from fastapi import Depends
from pydantic import BaseModel, Field
import thynkpdf_engine as eng

AType = Literal["highlight", "underline", "strikeout", "ink", "text", "freetext", "square", "circle", "line", "arrow", "stamp"]


class Annotation(BaseModel):
    id: str; page: int; type: str
    rect: list[float]; quad_points: list[float] | None = None; ink_list: list[list[list[float]]] | None = None
    color: list[float]; opacity: float | None = None; border_width: float | None = None
    contents: str | None = None; author: str | None = None; created_at: str | None = None; modified_at: str | None = None
    stamp_name: str | None = None; line: list[float] | None = None; in_reply_to: str | None = None
    state: Literal["open", "resolved"] | None = None
    supported: bool = Field(True, description="false = foreign subtype (Link, Popup...) listed read-only")


class AnnotationsOut(BaseModel):
    document_id: str; version: int; annotations: list[Annotation]


class AnnotationIn(BaseModel):
    id: str | None = Field(None, description="required for update, omitted for add")
    page: int | None = Field(None, ge=1); type: AType | None = None
    rect: list[float] | None = None; quad_points: list[float] | None = None; ink_list: list[list[list[float]]] | None = None
    color: list[float] | None = None; opacity: float | None = Field(None, gt=0, le=1); border_width: float | None = Field(None, ge=0, le=50)
    contents: str | None = Field(None, max_length=20000); author: str | None = Field(None, max_length=200)
    stamp_name: str | None = None; line: list[float] | None = None; in_reply_to: str | None = None
    state: Literal["open", "resolved"] | None = None; font_size: float | None = Field(None, gt=0, le=200)


def register(app, c):
    class BatchIn(BaseModel):
        document_id: str; expected_version: int = Field(ge=1)
        add: list[AnnotationIn] = Field([], max_length=500); update: list[AnnotationIn] = Field([], max_length=500)
        delete: list[str] = Field([], max_length=500)

    @app.get("/pdf/{doc_id}/annotations", response_model=AnnotationsOut, tags=["annotations"])
    def list_(doc_id: str, version: int | None = None, page: int | None = None, p=Depends(c.principal), s=Depends(c.db)):
        d = c.get_doc(s, p, doc_id); v = c.get_ver(s, d, number=version)
        items = [a for a in eng.list_annotations(c.load(d, v)) if page is None or a["page"] == page]
        return AnnotationsOut(document_id=d.id, version=v.number, annotations=items)

    @app.post("/pdf/annotations", response_model=c.VersionResult, tags=["annotations"])
    def batch(b: BatchIn, p=Depends(c.principal), s=Depends(c.db)):
        """Atomic add/update/delete → one new version. report.ids = new ids in add order.
        Replies: type "text" + in_reply_to (/IRT). Resolve: state "resolved". Deleting a parent deletes its replies."""
        if not (b.add or b.update or b.delete): raise c.ApiError(422, "VALIDATION_ERROR", "Nothing to apply")
        for a in b.add:
            if a.id or a.page is None or a.type is None: raise c.ApiError(422, "VALIDATION_ERROR", "add items need page and type, no id")
            if a.in_reply_to and a.type != "text": raise c.ApiError(422, "VALIDATION_ERROR", "replies must be type text")
        if any(not u.id for u in b.update): raise c.ApiError(422, "VALIDATION_ERROR", "update items need id")
        d, data = c.writable(s, p, b.document_id)
        add = [{**a.model_dump(exclude_none=True), "author": a.author or p.user_id} for a in b.add]
        out, ids = eng.apply_annotations(data, add, [u.model_dump(exclude_none=True) for u in b.update], b.delete)
        v = c.new_version(s, p, d, b.expected_version, out, "annotations", {"added": len(add), "updated": len(b.update), "deleted": b.delete})
        return c.vres(d, v, {"ids": ids, "updated": [u.id for u in b.update], "deleted": b.delete})
