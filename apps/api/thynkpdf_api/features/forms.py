from typing import Any, Literal
from fastapi import Depends, Query
from fastapi.responses import PlainTextResponse, JSONResponse
from pydantic import BaseModel, Field
import thynkpdf_engine as eng


class FormField(BaseModel):
    name: str; type: Literal["text", "checkbox", "radio", "dropdown", "listbox", "signature", "pushbutton", "unknown"]
    multiline: bool = False; value: Any = None; required: bool; read_only: bool; options: list[str] | None = None
    max_length: int | None = None; page: int | None = None; rect: list[float]; has_actions: bool; calculated: bool


class FormsOut(BaseModel):
    document_id: str; version: int; fields: list[FormField]


def _ff(f):
    return {**f, "type": "text" if f["type"] == "multiline" else f["type"], "multiline": f["type"] == "multiline"}


def register(app, c):
    class FieldSpec(BaseModel):
        name: str = Field(pattern=r"^[A-Za-z0-9_\-]{1,100}$")
        type: Literal["text", "multiline", "checkbox", "radio", "dropdown", "listbox", "signature"]
        multiline: bool = False
        page: int = Field(ge=1); rect: list[float] | None = None; rects: list[list[float]] | None = None
        options: list[str] | None = None; default: Any = None; required: bool = False; read_only: bool = False
        max_length: int | None = Field(None, ge=1); font_size: float = 10
    class FieldsIn(BaseModel):
        document_id: str; expected_version: int = Field(ge=1)
        add: list[FieldSpec] = Field([], max_length=500); delete: list[str] = Field([], max_length=500)
    class FillIn(BaseModel):
        document_id: str; expected_version: int = Field(ge=1)
        values: dict[str, Any] | None = None; csv: str | None = Field(None, description="CSV with columns name,value (import)")
        flatten: bool = False
    class FlattenIn(BaseModel):
        document_id: str; expected_version: int = Field(ge=1)
        confirm: bool = Field(description="Must be true: flattening removes interactivity in the new version")

    @app.get("/pdf/{doc_id}/forms", response_model=FormsOut, tags=["forms"])
    def fields(doc_id: str, version: int | None = None, p=Depends(c.principal), s=Depends(c.db)):
        d = c.get_doc(s, p, doc_id); v = c.get_ver(s, d, number=version)
        return FormsOut(document_id=d.id, version=v.number, fields=[_ff(f) for f in eng.list_fields(c.load(d, v))])

    @app.post("/pdf/forms/fields", response_model=c.VersionResult, tags=["forms"])
    def edit_fields(b: FieldsIn, p=Depends(c.principal), s=Depends(c.db)):
        """Atomic: delete listed fields (and their widgets), then add new ones. One new version."""
        if not (b.add or b.delete): raise c.ApiError(422, "VALIDATION_ERROR", "Nothing to apply")
        d, data = c.writable(s, p, b.document_id)
        if b.delete: data = eng.delete_fields(data, b.delete)
        if b.add:
            specs = [{**f.model_dump(), "type": "multiline" if f.type == "text" and f.multiline else f.type} for f in b.add]
            data = eng.create_fields(data, specs)
        v = c.new_version(s, p, d, b.expected_version, data, "form_fields", {"added": [f.name for f in b.add], "deleted": b.delete})
        return c.vres(d, v, {"added": [f.name for f in b.add], "deleted": b.delete})

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
