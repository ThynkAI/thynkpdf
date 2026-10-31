from typing import Literal
from fastapi import Depends, Query
from pydantic import BaseModel, Field
import thynkpdf_engine as eng

AType = Literal["highlight", "note", "ink", "rectangle", "ellipse", "line"]


class Annotation(BaseModel):
    id: str; page: int; type: str; subtype: str; rect: list[float]; contents: str; author: str; color: list[float]
    editable: bool; ink: list[list[float]] | None = None


def register(app, c):
    class AnnotIn(BaseModel):
        document_id: str; expected_version: int = Field(ge=1)
        type: AType; page: int = Field(ge=1)
        rect: list[float] | None = Field(None, description="[x0,y0,x1,y1]; for line: endpoints [x0,y0,x1,y1]")
        ink: list[list[float]] | None = Field(None, description="ink strokes [[x1,y1,x2,y2,...],...]")
        color: list[float] | None = None; width: float = Field(1.5, gt=0, le=50)
        contents: str | None = Field(None, max_length=10000)
    class AnnotPatch(BaseModel):
        document_id: str; expected_version: int = Field(ge=1)
        rect: list[float] | None = None; ink: list[list[float]] | None = None; color: list[float] | None = None
        contents: str | None = Field(None, max_length=10000); width: float | None = None
    class AnnotResult(c.VersionResult):
        annotation_id: str

    @app.get("/pdf/{doc_id}/annotations", response_model=list[Annotation], tags=["annotations"])
    def list_(doc_id: str, page: int | None = None, p=Depends(c.principal), s=Depends(c.db)):
        d = c.get_doc(s, p, doc_id); items = eng.list_annotations(c.load(d, c.get_ver(s, d)))
        return [a for a in items if page is None or a["page"] == page]

    @app.post("/pdf/annotations", response_model=AnnotResult, tags=["annotations"])
    def create(b: AnnotIn, p=Depends(c.principal), s=Depends(c.db)):
        d, data = c.writable(s, p, b.document_id)
        a = b.model_dump(exclude={"document_id", "expected_version"}); a["author"] = p.user_id
        out, aid = eng.add_annotation(data, a)
        v = c.new_version(s, p, d, b.expected_version, out, "annotation_add", {"annotation_id": aid, "type": b.type})
        return AnnotResult(**c.vres(d, v).model_dump(), annotation_id=aid)

    @app.patch("/pdf/annotations/{annotation_id}", response_model=AnnotResult, tags=["annotations"])
    def update(annotation_id: str, b: AnnotPatch, p=Depends(c.principal), s=Depends(c.db)):
        d, data = c.writable(s, p, b.document_id)
        out = eng.update_annotation(data, annotation_id, b.model_dump(exclude={"document_id", "expected_version"}))
        v = c.new_version(s, p, d, b.expected_version, out, "annotation_update", {"annotation_id": annotation_id})
        return AnnotResult(**c.vres(d, v).model_dump(), annotation_id=annotation_id)

    @app.delete("/pdf/annotations/{annotation_id}", response_model=AnnotResult, tags=["annotations"])
    def delete(annotation_id: str, document_id: str = Query(...), expected_version: int = Query(..., ge=1),
               p=Depends(c.principal), s=Depends(c.db)):
        d, data = c.writable(s, p, document_id)
        v = c.new_version(s, p, d, expected_version, eng.delete_annotation(data, annotation_id), "annotation_delete", {"annotation_id": annotation_id})
        return AnnotResult(**c.vres(d, v).model_dump(), annotation_id=annotation_id)
