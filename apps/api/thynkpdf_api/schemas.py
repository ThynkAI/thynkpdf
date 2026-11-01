from pydantic import BaseModel, Field

class Limitation(BaseModel):
    code: str
    message: str
    font: str | None = None

class PageOps(BaseModel):
    rotate: bool; reorder: bool; extract: bool; split: bool; merge: bool
    insert_blank: bool = True; delete: bool = True; duplicate: bool = True

class EditOps(BaseModel):
    text_replace: bool; text_delete: bool; text_move: bool; text_insert: bool

class PageCapability(BaseModel):
    number: int
    text_replace: bool
    text_delete: bool
    text_move: bool
    text_insert: bool
    editable_fonts: list[str]
    limitations: list[Limitation]

class XfaCapabilities(BaseModel):
    present: bool; kind: str; read: bool; schema_: bool = Field(alias="schema", serialization_alias="schema"); fill: bool
    xml_import_export: bool; convert: bool; flatten: bool; has_scripts: bool; error: str | None = None
    model_config = {"populate_by_name": True}


class CapabilitiesOut(BaseModel):
    document_id: str
    version: int
    version_id: str
    page_ops: PageOps
    edit_ops: EditOps
    compress: bool
    annotations: bool
    forms: bool
    xfa: XfaCapabilities | None = None
    text_replace: bool
    document_limitations: list[Limitation]
    pages: list[PageCapability]
    safe_alternatives: list[str]

class FontInfo(BaseModel):
    resource: str; base_font: str; subtype: str; embedded: bool; used: bool; encoding: str | None

class PageInfo(BaseModel):
    number: int; width: float; height: float; rotation: int; annotations: int; fonts: list[FontInfo]; images: int

class MetadataOut(BaseModel):
    document_id: str; version: int; version_id: str; pdf_version: str; page_count: int; info: dict[str, str]
    is_encrypted: bool; has_outlines: bool; has_acroform: bool; form_field_count: int; has_signatures: bool
    has_javascript: bool; attachments: list[str]; is_linearized: bool; pages: list[PageInfo]
