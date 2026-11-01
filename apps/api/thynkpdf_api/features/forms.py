from typing import Any, Literal
from fastapi import Depends, Query
from fastapi.responses import PlainTextResponse, JSONResponse, Response
from pydantic import BaseModel, Field
import thynkpdf_engine as eng


class FormField(BaseModel):
    name: str; type: Literal["text", "checkbox", "radio", "dropdown", "listbox", "signature", "pushbutton", "unknown"]
    multiline: bool = False; value: Any = None; required: bool; read_only: bool; options: list[str] | None = None
    max_length: int | None = None; page: int | None = None; rect: list[float]; has_actions: bool; calculated: bool


class XfaInfo(BaseModel):
    present: bool; kind: Literal["none", "hybrid", "dynamic"]; form: Literal["stream", "array"] | None = None
    packets: list[str]; has_scripts: bool; script_count: int = 0; needs_rendering: bool = False
    acroform_widgets: int = 0; xml_safe: bool | None = None


class FormsOut(BaseModel):
    document_id: str; version: int; fields: list[FormField]; xfa: XfaInfo


class XfaDataField(BaseModel):
    name: str; value: str; acroform_field: str | None = None


class XfaDataOut(BaseModel):
    document_id: str; version: int; xfa: XfaInfo; fields: list[XfaDataField]


class XfaLayout(BaseModel):
    x: float; y: float; w: float; h: float; units: str; origin: str


class XfaOccur(BaseModel):
    min: int; max: int = Field(description="-1 = unbounded"); initial: int


class XfaSchemaField(BaseModel):
    name: str | None = Field(description="Data path in the datasets packet (fill key); null if unbound (bind match=none)")
    som: str = Field(description="Fully indexed SOM path, e.g. form1[0].#subform[2].Name[0]; equals the AcroForm field name on hybrid forms")
    acroform_field: str | None = Field(None, description="Matching AcroForm field (hybrid only)")
    section: str | None = Field(None, description="SOM path of the enclosing subform"); section_name: str | None = None
    section_caption: str | None = None
    occur: XfaOccur | None = Field(None, description="Repeat rules of the nearest repeatable subform (max != 1)")
    instance: int | None = Field(None, description="0-based instance of that repeatable subform")
    type: Literal["text", "numeric", "date", "checkbox", "choice", "radio", "signature", "button", "image", "barcode", "password"]
    caption: str | None = None; tooltip: str | None = Field(None, description="assist/toolTip help text")
    options: list[str] | None = None; option_captions: list[str] | None = None
    multi_select: bool | None = None; on_value: str | None = None; value: Any = None
    required: bool; read_only: bool; multiline: bool; max_chars: int | None = None; layout: XfaLayout


class XfaFillReport(BaseModel):
    filled: list[str]; kind: str; acroform_updated: list[str]; datasets_updated: list[str]; not_bound: list[str] = []
    missing_required: list[str] = []; usage_rights_removed: bool = False; form_state_packet_removed: bool = False


class XfaImportReport(BaseModel):
    imported: int; mode: Literal["merge", "replace"]; kind: str; acroform_updated: list[str]
    missing_required: list[str] = []; usage_rights_removed: bool = False; form_state_packet_removed: bool = False


class XfaConvertReport(BaseModel):
    mode: Literal["stripped_xfa", "rendered_from_template"]; warnings: list[str]; scripts_ignored: int = 0
    kept_acroform_widgets: int | None = None; usage_rights_removed: bool | None = None
    pages: int | None = None; fields: int | None = None; field_map: dict[str, dict] | None = None


class XfaSchemaOut(BaseModel):
    document_id: str; version: int; xfa: XfaInfo; fields: list[XfaSchemaField]; warnings: list[str]; scripts_ignored: int


def _ff(f):
    return {**f, "type": "text" if f["type"] == "multiline" else f["type"], "multiline": f["type"] == "multiline"}


def _cas(c, s, p, b):
    """Load for writing and check expected_version FIRST, so a stale write is always 409 VERSION_CONFLICT
    (never a content error computed against a newer version)."""
    d, data = c.writable(s, p, b.document_id)
    if b.expected_version != d.current_version:
        raise c.ApiError(409, "VERSION_CONFLICT", "Document changed since expected_version", {"current_version": d.current_version})
    return d, data


def register(app, c):
    class XfaFillResult(c.VersionResult): report: XfaFillReport
    class XfaImportResult(c.VersionResult): report: XfaImportReport
    class XfaConvertResult(c.VersionResult): report: XfaConvertReport

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
        data = c.load(d, v)
        return FormsOut(document_id=d.id, version=v.number, fields=[_ff(f) for f in eng.list_fields(data)], xfa=eng.xfa.detect(data))

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
        d, data = _cas(c, s, p, b)
        if (b.values is None) == (b.csv is None): raise c.ApiError(422, "VALIDATION_ERROR", "Provide exactly one of values or csv")
        vals = b.values if b.values is not None else eng.parse_csv_values(b.csv, eng.list_fields(data))
        out, rep = eng.fill_fields(data, vals)
        if eng.xfa.detect(out)["kind"] == "hybrid":
            out = eng.xfa.sync_datasets_from_acro(out, list(vals)); rep["xfa_datasets_synced"] = True
        if b.flatten: out = eng.flatten(eng.xfa.strip_xfa(out)); rep["flattened"] = True
        return c.vres(d, c.new_version(s, p, d, b.expected_version, out, "form_fill", {"fields": list(vals), "flatten": b.flatten}), rep)

    @app.post("/pdf/forms/flatten", response_model=c.VersionResult, tags=["forms"])
    def flat(b: FlattenIn, p=Depends(c.principal), s=Depends(c.db)):
        if not b.confirm: raise c.ApiError(422, "CONFIRMATION_REQUIRED", "Set confirm=true to flatten (previous version stays recoverable)")
        d, data = _cas(c, s, p, b)
        warns = ["All annotations and widgets were burned into page content; form is no longer interactive."]
        kind = eng.xfa.detect(data)["kind"]
        if kind == "hybrid": data = eng.xfa.strip_xfa(data); warns.append("XFA packets were removed before flattening (hybrid form).")
        elif kind == "dynamic":
            data, crep = eng.xfa.convert_to_acroform(data); warns.append("Dynamic XFA was rendered to AcroForm from its template before flattening.")
            warns += [f"xfa:{w}" for w in crep["warnings"]]
        return c.vres(d, c.new_version(s, p, d, b.expected_version, eng.flatten(data), "form_flatten", {"xfa_kind": kind}), {"warnings": warns})

    class XfaFillIn(BaseModel):
        document_id: str; expected_version: int = Field(ge=1)
        values: dict[str, Any] = Field(description="Keys: XFA data path (form1.full_name) or AcroForm full name (form1[0].full_name[0])", max_length=5000)
    class XfaVersioned(BaseModel):
        document_id: str; expected_version: int = Field(ge=1)
    class XfaImportIn(BaseModel):
        document_id: str; expected_version: int = Field(ge=1)
        mode: Literal["merge", "replace"] = Field("merge", description="merge (default): only values present in the XML change; replace: datasets packet replaced wholesale")
        xml: str = Field(max_length=5_000_000, description="<xfa:datasets>, <xfa:data> or a bare record element. DTDs/entities are rejected.")

    @app.get("/pdf/{doc_id}/forms/xfa", response_model=XfaDataOut, tags=["forms"])
    def xfa_data(doc_id: str, version: int | None = None, p=Depends(c.principal), s=Depends(c.db)):
        """Flat list of the XFA datasets values. Scripts are never executed."""
        d = c.get_doc(s, p, doc_id); v = c.get_ver(s, d, number=version)
        r = eng.xfa.read_data(c.load(d, v)); return XfaDataOut(document_id=d.id, version=v.number, **r)

    @app.get("/pdf/{doc_id}/forms/xfa/schema", response_model=XfaSchemaOut, tags=["forms"])
    def xfa_schema(doc_id: str, version: int | None = None, p=Depends(c.principal), s=Depends(c.db)):
        """Field schema parsed from the XFA template (subforms, fields, exclusion groups, bindings, captions, layout)."""
        d = c.get_doc(s, p, doc_id); v = c.get_ver(s, d, number=version)
        return XfaSchemaOut(document_id=d.id, version=v.number, **eng.xfa.template_schema(c.load(d, v)))

    @app.get("/pdf/{doc_id}/forms/xfa/data.xml", tags=["forms"], responses={200: {"content": {"application/xml": {}}}})
    def xfa_export(doc_id: str, version: int | None = None, p=Depends(c.principal), s=Depends(c.db)):
        d = c.get_doc(s, p, doc_id); v = c.get_ver(s, d, number=version)
        return Response(eng.xfa.export_xml(c.load(d, v)), media_type="application/xml",
                        headers={"Content-Disposition": 'attachment; filename="xfa-data.xml"'})

    @app.post("/pdf/forms/xfa/data", response_model=XfaImportResult, tags=["forms"])
    def xfa_import(b: XfaImportIn, p=Depends(c.principal), s=Depends(c.db)):
        d, data = _cas(c, s, p, b)
        out, rep = eng.xfa.import_xml(data, b.xml.encode("utf-8"), b.mode)
        return c.vres(d, c.new_version(s, p, d, b.expected_version, out, "xfa_import", {"imported": rep["imported"], "mode": b.mode}), rep)

    @app.post("/pdf/forms/xfa/fill", response_model=XfaFillResult, tags=["forms"])
    def xfa_fill(b: XfaFillIn, p=Depends(c.principal), s=Depends(c.db)):
        """Hybrid: writes AcroForm field AND datasets node. Dynamic: datasets only."""
        d, data = _cas(c, s, p, b)
        out, rep = eng.xfa.fill(data, b.values)
        return c.vres(d, c.new_version(s, p, d, b.expected_version, out, "xfa_fill", {"fields": list(b.values)}), rep)

    @app.post("/pdf/forms/xfa/convert", response_model=XfaConvertResult, tags=["forms"])
    def xfa_convert(b: XfaVersioned, p=Depends(c.principal), s=Depends(c.db)):
        """Hybrid: strip /XFA + NeedsRendering, keep widgets. Dynamic: render pages + widgets from the template, pre-filled."""
        d, data = _cas(c, s, p, b)
        out, rep = eng.xfa.convert_to_acroform(data)
        return c.vres(d, c.new_version(s, p, d, b.expected_version, out, "xfa_convert", {"mode": rep["mode"]}), rep)

    @app.get("/pdf/{doc_id}/forms/export", tags=["forms"], responses={200: {"content": {"application/json": {}, "text/csv": {}}}})
    def export(doc_id: str, format: Literal["json", "csv"] = "json", p=Depends(c.principal), s=Depends(c.db)):
        d = c.get_doc(s, p, doc_id); r = eng.export_values(c.load(d, c.get_ver(s, d)), format)
        if format == "csv": return PlainTextResponse(r, media_type="text/csv", headers={"Content-Disposition": 'attachment; filename="form.csv"'})
        return JSONResponse(r)
