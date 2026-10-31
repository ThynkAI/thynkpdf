from typing import Any, Literal
from fastapi import Depends, Query
from fastapi.responses import PlainTextResponse, JSONResponse
from pydantic import BaseModel, Field
import thynkpdf_engine as eng


class FormField(BaseModel):
    name: str; type: str; value: Any = None; required: bool; read_only: bool; options: list[str] | None = None
    max_length: int | None = None; page: int | None = None; rect: list[float]; has_actions: bool; calculated: bool


def register(app, c):
    class FieldSpec(BaseModel):
        name: str = Field(pattern=r"^[A-Za-z0-9_\-]{1,100}$")
        type: Literal["text", "multiline", "checkbox", "radio", "dropdown", "listbox", "signature"]
        page: int = Field(ge=1); rect: list[float] | None = None; rects: list[list[float]] | None = None
        options: list[str] | None = None; default: Any = None; required: bool = False; read_only: bool = False
        max_length: int | None = Field(None, ge=1); font_size: float = 10
    class CreateIn(BaseModel):
        document_id: str; expected_version: int = Field(ge=1); fields: list[FieldSpec] = Field(min_length=1, max_length=500)
    class FillIn(BaseModel):
        document_id: str; expected_version: int = Field(ge=1)
        values: dict[str, Any] | None = None; csv: str | None = Field(None, description="CSV with columns name,value (import)")
        flatten: bool = False
    class FlattenIn(BaseModel):
        document_id: str; expected_version: int = Field(ge=1)
        confirm: bool = Field(description="Must be true: flattening removes interactivity in the new version")

    @app.get("/pdf/{doc_id}/forms", response_model=list[FormField], tags=["forms"])
    def fields(doc_id: str, p=Depends(c.principal), s=Depends(c.db)):
        d = c.get_doc(s, p, doc_id); return eng.list_fields(c.load(d, c.get_ver(s, d)))

    @app.post("/pdf/forms", response_model=c.VersionResult, tags=["forms"])
    def create(b: CreateIn, p=Depends(c.principal), s=Depends(c.db)):
        d, data = c.writable(s, p, b.document_id)
        out = eng.create_fields(data, [f.model_dump() for f in b.fields])
        return c.vres(d, c.new_version(s, p, d, b.expected_version, out, "form_create", {"fields": [f.name for f in b.fields]}),
                      {"created": [f.name for f in b.fields]})

    @app.post("/pdf/forms/fill", response_model=c.VersionResult, tags=["forms"])
    def fill(b: FillIn, p=Depends(c.principal), s=Depends(c.db)):
        d, data = c.writable(s, p, b.document_id)
        if (b.values is None) == (b.csv is None): raise c.ApiError(422, "VALIDATION_ERROR", "Provide exactly one of values or csv")
        vals = b.values if b.values is not None else eng.parse_csv_values(b.csv, eng.list_fields(data))
        out, rep = eng.fill_fields(data, vals)
        if b.flatten: out = eng.flatten(out); rep["flattened"] = True
        return c.vres(d, c.new_version(s, p, d, b.expected_version, out, "form_fill", {"fields": list(vals), "flatten": b.flatten}), rep)

    @app.post("/pdf/forms/flatten", response_model=c.VersionResult, tags=["forms"])
    def flat(b: FlattenIn, p=Depends(c.principal), s=Depends(c.db)):
        if not b.confirm: raise c.ApiError(422, "CONFIRMATION_REQUIRED", "Set confirm=true to flatten (previous version stays recoverable)")
        d, data = c.writable(s, p, b.document_id)
        return c.vres(d, c.new_version(s, p, d, b.expected_version, eng.flatten(data), "form_flatten", {}),
                      {"warnings": ["All annotations and widgets were burned into page content; form is no longer interactive."]})

    @app.get("/pdf/{doc_id}/forms/export", tags=["forms"], responses={200: {"content": {"application/json": {}, "text/csv": {}}}})
    def export(doc_id: str, format: Literal["json", "csv"] = "json", p=Depends(c.principal), s=Depends(c.db)):
        d = c.get_doc(s, p, doc_id); r = eng.export_values(c.load(d, c.get_ver(s, d)), format)
        if format == "csv": return PlainTextResponse(r, media_type="text/csv", headers={"Content-Disposition": 'attachment; filename="form.csv"'})
        return JSONResponse(r)
