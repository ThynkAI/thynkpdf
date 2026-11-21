"""True redaction (content removal) and "Remove hidden information". Engine: thynkpdf_engine.redaction (pikepdf, no AGPL).
Document text is treated as untrusted data: it is searched and measured only; embedded scripts are never executed."""
import re
from typing import Literal
from fastapi import Depends
from pydantic import BaseModel, Field
import thynkpdf_engine as eng

R = eng.redaction


class RedactMark(BaseModel):
    page: int = Field(ge=1)
    rect: list[float] | None = Field(None, min_length=4, max_length=4, description="[x0, y0, x1, y1] in PDF user space (points, origin bottom-left)")
    whole_page: bool = False


class SanitizeOpts(BaseModel):
    """'Remove hidden information'. Every option defaults to on."""
    metadata: bool = True; javascript: bool = True; attachments: bool = True; comments: bool = True
    forms: bool = True; hidden_text: bool = True


class RedactApplyIn(BaseModel):
    document_id: str; expected_version: int = Field(ge=1)
    marks: list[RedactMark] = Field(default_factory=list, max_length=5000)
    fill: Literal["black", "none"] | list[float] = "black"
    sanitize: SanitizeOpts | None = None
    output: Literal["new_document", "new_version"] = "new_document"
    filename: str | None = None
    confirm: bool = Field(False, description="Must be true: redaction permanently removes content")


class RedactSearchIn(BaseModel):
    document_id: str; version: int | None = None
    query: str | None = Field(None, max_length=300)
    regex: bool = False; case_sensitive: bool = False; whole_word: bool = False
    patterns: list[Literal["email", "phone", "ssn", "sin", "credit_card", "postal_code", "date"]] = Field(default_factory=list)
    pages: list[int] | None = None


class RedactImagesIn(BaseModel):
    document_id: str; version: int | None = None; pages: list[int] | None = None


def register(app, c):
    def read(s, p, doc_id, version=None):
        d = c.get_doc(s, p, doc_id); v = c.get_ver(s, d, number=version); return d, v, c.load(d, v)

    @app.post("/pdf/redact/search", tags=["redaction"])
    def search(b: RedactSearchIn, p=Depends(c.principal), s=Depends(c.db)):
        """Find text or common patterns (email, phone, SSN/SIN, card numbers, postal codes, dates) and return their boxes
        so they can be reviewed as redaction marks. Nothing is changed."""
        d, v, data = read(s, p, b.document_id, b.version)
        r = R.search_text(data, b.query, regex=b.regex, case_sensitive=b.case_sensitive, whole_word=b.whole_word, patterns=list(b.patterns), pages=b.pages)
        return {"document_id": d.id, "version": v.number, **r}

    @app.post("/pdf/redact/images", tags=["redaction"])
    def images(b: RedactImagesIn, p=Depends(c.principal), s=Depends(c.db)):
        """Where images are drawn on each page (PDF user space), so whole images can be marked for redaction."""
        d, v, data = read(s, p, b.document_id, b.version)
        return {"document_id": d.id, "version": v.number, "images": R.list_images(data, b.pages)}

    @app.post("/pdf/redact/apply", response_model=c.VersionResult, tags=["redaction"])
    def apply(b: RedactApplyIn, p=Depends(c.principal), s=Depends(c.db)):
        """Permanently removes text, vector graphics and image pixels under every mark (and whole pages), then optionally
        removes hidden information. Default output is a NEW document; the original is left untouched.
        output=new_version replaces the current version, but earlier versions keep the original content."""
        if not b.confirm:
            raise c.ApiError(422, "CONFIRMATION_REQUIRED", "Redaction permanently removes content; send confirm=true")
        if not b.marks and b.sanitize is None:
            raise c.ApiError(422, "VALIDATION_ERROR", "Add at least one redaction mark or choose Remove hidden information")
        for m in b.marks:
            if not m.whole_page and m.rect is None:
                raise c.ApiError(422, "VALIDATION_ERROR", "Each mark needs a rect or whole_page=true")
        fill = (0.0, 0.0, 0.0) if b.fill == "black" else None if b.fill == "none" else tuple(b.fill[:3])
        if b.output == "new_version": d, data = c.writable(s, p, b.document_id)
        else:
            c.need(p, "member"); d, data = c.writable(s, p, b.document_id, allow_signed=True)
        if b.expected_version != d.current_version:
            raise c.ApiError(409, "VERSION_CONFLICT", "Document changed since expected_version", {"current_version": d.current_version})
        marks = [{"page": m.page, "rect": m.rect, "whole_page": m.whole_page} for m in b.marks]
        sopts = b.sanitize.model_dump() if b.sanitize is not None else None
        if marks: out, rep = R.redact(data, marks, fill, sopts)
        else: out, rep = R.sanitize(data, sopts)
        params = {"marks": len(marks), "fill": b.fill, "sanitize": sopts, "output": b.output}  # mark text is never logged
        rep = {**rep, "output": b.output}
        if b.output == "new_version":
            return c.vres(d, c.new_version(s, p, d, b.expected_version, out, "redact", params), rep)
        base = re.sub(r"\.pdf$", "", d.filename, flags=re.I)
        nd, v = c.new_document(s, p, b.filename or f"{base}-redacted.pdf", out, "redact", {**params, "source_document_id": d.id, "source_version": d.current_version})
        return c.vres(nd, v, {**rep, "source_document_id": d.id})
