from __future__ import annotations
import io, time
from dataclasses import dataclass, field
import pikepdf
from pikepdf import Pdf, Name, Operator, String, Array

__all__ = ["EngineError", "open_pdf", "inspect", "capabilities", "rotate", "reorder",
           "extract", "merge", "split", "replace_text", "compress", "STANDARD_14"]

STANDARD_14 = {"Times-Roman", "Times-Bold", "Times-Italic", "Times-BoldItalic", "Helvetica",
    "Helvetica-Bold", "Helvetica-Oblique", "Helvetica-BoldOblique", "Courier", "Courier-Bold",
    "Courier-Oblique", "Courier-BoldOblique", "Symbol", "ZapfDingbats"}
SIMPLE_ENC = {None, "/WinAnsiEncoding", "/StandardEncoding", "/MacRomanEncoding"}
MAX_PAGES = 5000


class EngineError(Exception):
    def __init__(self, code: str, message: str, details: dict | None = None):
        super().__init__(message); self.code, self.message, self.details = code, message, details or {}


def open_pdf(data: bytes) -> Pdf:
    if not data.startswith(b"%PDF-") and b"%PDF-" not in data[:1024]:
        raise EngineError("INVALID_FILE_TYPE", "File is not a PDF (magic bytes missing)")
    try:
        pdf = Pdf.open(io.BytesIO(data))
    except pikepdf.PasswordError:
        raise EngineError("PDF_ENCRYPTED", "PDF is password protected")
    except Exception:
        raise EngineError("PDF_MALFORMED", "PDF could not be parsed")
    if len(pdf.pages) == 0:
        raise EngineError("PDF_MALFORMED", "PDF has no pages")
    if len(pdf.pages) > MAX_PAGES:
        raise EngineError("PDF_TOO_MANY_PAGES", f"PDF exceeds {MAX_PAGES} pages")
    return pdf


def _save(pdf: Pdf, **kw) -> bytes:
    b = io.BytesIO(); pdf.save(b, **kw); return b.getvalue()


def _fonts(page) -> dict:
    out = {}
    res = page.obj.get("/Resources")
    fonts = res.get("/Font") if res is not None else None
    if fonts is None:
        return out
    used = set()
    try:
        cur = None  # a font counts as used only if text is shown while it is selected
        for operands, op in pikepdf.parse_content_stream(page, "Tf Tj TJ ' \""):
            if str(op) == "Tf": cur = str(operands[0])
            elif cur: used.add(cur)
    except Exception:
        used = None  # unparseable stream -> treat all as used (conservative)
    for k, f in fonts.items():
        desc = f.get("/FontDescriptor")
        embedded = bool(desc is not None and any(x in desc for x in ("/FontFile", "/FontFile2", "/FontFile3")))
        enc = f.get("/Encoding")
        out[k] = {"resource": k, "base_font": str(f.get("/BaseFont", ""))[1:], "subtype": str(f.get("/Subtype", "")),
                  "embedded": embedded, "used": used is None or str(k) in used, "encoding": str(enc) if isinstance(enc, Name) else (None if enc is None else "custom")}
    return out


def _font_editable(f: dict) -> tuple[bool, str | None]:
    if f["subtype"] != "/Type1": return False, "FONT_NOT_SIMPLE_TYPE1"
    if f["embedded"]: return False, "FONT_EMBEDDED_SUBSET_RISK"
    if f["base_font"] not in STANDARD_14: return False, "FONT_NOT_STANDARD_14"
    if f["encoding"] not in SIMPLE_ENC: return False, "FONT_CUSTOM_ENCODING"
    return True, None


def inspect(data: bytes) -> dict:
    pdf = open_pdf(data)
    info = {}
    try:
        for k, v in pdf.docinfo.items(): info[str(k)[1:]] = str(v)
    except Exception: pass
    root = pdf.Root
    pages = []
    for i, p in enumerate(pdf.pages):
        mb = [float(x) for x in p.mediabox]
        pages.append({"number": i + 1, "width": mb[2] - mb[0], "height": mb[3] - mb[1],
                      "rotation": int(p.obj.get("/Rotate", 0)), "annotations": len(p.obj.get("/Annots", [])),
                      "fonts": list(_fonts(p).values()),
                      "images": sum(1 for _ in p.images.keys())})
    acro = root.get("/AcroForm")
    return {"pdf_version": pdf.pdf_version, "page_count": len(pdf.pages), "info": info,
            "is_encrypted": pdf.is_encrypted, "has_outlines": "/Outlines" in root,
            "has_acroform": acro is not None, "form_field_count": len(acro.get("/Fields", [])) if acro is not None else 0,
            "has_signatures": bool(acro is not None and int(acro.get("/SigFlags", 0)) & 1),
            "has_javascript": "/Names" in root and "/JavaScript" in root.Names,
            "attachments": list(pdf.attachments.keys()), "is_linearized": pdf.is_linearized, "pages": pages}


def capabilities(data: bytes) -> dict:
    m = inspect(data)
    doc_lims = []
    if m["has_signatures"]: doc_lims.append({"code": "SIGNED_DOCUMENT", "message": "Edits invalidate existing signatures; content edits disabled."})
    if m["info"].get("GTS_PDFA1Version") or m["info"].get("pdfa"): doc_lims.append({"code": "PDFA", "message": "PDF/A conformance may be lost."})
    pages = []
    for p in m["pages"]:
        lims, ok_fonts = [], []
        if not any(f.get("used", True) for f in p["fonts"]):
            lims.append({"code": "NO_TEXT_LAYER", "message": "No fonts on page (scanned/vector-only?). Use OCR first."})
        for f in p["fonts"]:
            if not f.get("used", True): continue
            ok, why = _font_editable(f)
            (ok_fonts.append(f["resource"]) if ok else lims.append({"code": why, "message": f"Font {f['base_font']} ({f['resource']}) not safely editable", "font": f["resource"]}))
        text_edit = bool(ok_fonts) and not m["has_signatures"]
        pages.append({"number": p["number"], "text_replace": text_edit, "editable_fonts": ok_fonts, "limitations": lims})
    page_ops = not m["has_signatures"]
    return {"page_ops": {op: page_ops for op in ("rotate", "reorder", "extract", "split", "merge")},
            "compress": True, "text_replace": any(p["text_replace"] for p in pages),
            "document_limitations": doc_lims, "pages": pages,
            "safe_alternatives": ["ocr (when text layer absent)", "annotations/comments", "replace page via merge"]}


def _check_pages(n: int, pages: list[int]):
    bad = [p for p in pages if not isinstance(p, int) or p < 1 or p > n]
    if bad: raise EngineError("INVALID_PAGE", "Page numbers out of range", {"invalid": bad, "page_count": n})


def rotate(data: bytes, pages: list[int] | None, angle: int) -> bytes:
    if angle % 90: raise EngineError("INVALID_ANGLE", "Angle must be a multiple of 90")
    pdf = open_pdf(data); n = len(pdf.pages); pages = pages or list(range(1, n + 1)); _check_pages(n, pages)
    for p in pages: pdf.pages[p - 1].rotate(angle, relative=True)
    return _save(pdf)


def reorder(data: bytes, order: list[int]) -> bytes:
    pdf = open_pdf(data); n = len(pdf.pages)
    if sorted(order) != list(range(1, n + 1)):
        raise EngineError("INVALID_ORDER", "order must be a permutation of 1..page_count", {"page_count": n})
    new = Pdf.new()
    for p in order: new.pages.append(pdf.pages[p - 1])
    _copy_info(pdf, new); return _save(new)


def _copy_info(src, dst):
    try:
        with dst.open_metadata(set_pikepdf_as_editor=False): pass
        for k, v in src.docinfo.items(): dst.docinfo[k] = v
    except Exception: pass


def extract(data: bytes, pages: list[int]) -> bytes:
    pdf = open_pdf(data); _check_pages(len(pdf.pages), pages)
    if not pages: raise EngineError("INVALID_PAGE", "No pages selected")
    new = Pdf.new()
    for p in pages: new.pages.append(pdf.pages[p - 1])
    return _save(new)


def merge(datas: list[bytes]) -> bytes:
    if len(datas) < 2: raise EngineError("INVALID_REQUEST", "Need at least two documents")
    new = Pdf.new()
    for d in datas:
        src = open_pdf(d); new.pages.extend(src.pages)
    return _save(new)


def split(data: bytes, ranges: list[list[int]]) -> list[bytes]:
    pdf = open_pdf(data); n = len(pdf.pages); out = []
    for r in ranges:
        if len(r) != 2 or r[0] > r[1]: raise EngineError("INVALID_RANGE", "Each range is [start, end]")
        _check_pages(n, r); out.append(extract(data, list(range(r[0], r[1] + 1))))
    return out


def replace_text(data: bytes, page: int, find: str, replace: str, occurrence: str = "all") -> tuple[bytes, int]:
    """Real content-stream edit: rewrite string operands of Tj/TJ/'/" for safe simple fonts.
    Only matches contained wholly within one string operand (no cross-run matches)."""
    caps = capabilities(data)
    _check_pages(caps["pages"][-1]["number"], [page])
    pc = caps["pages"][page - 1]
    if not pc["text_replace"]:
        raise EngineError("EDIT_NOT_SUPPORTED", "Text on this page cannot be safely edited", {"limitations": pc["limitations"] + caps["document_limitations"]})
    try:
        fb, rb = find.encode("cp1252"), replace.encode("cp1252")
    except UnicodeEncodeError:
        raise EngineError("EDIT_UNSUPPORTED_CHARACTERS", "Characters not representable in the font's simple encoding")
    if not fb: raise EngineError("INVALID_REQUEST", "find must be non-empty")
    pdf = open_pdf(data); pg = pdf.pages[page - 1]
    pg.contents_coalesce()
    ops = pikepdf.parse_content_stream(pg)
    editable, cur, count, out, skipped = set(pc["editable_fonts"]), None, 0, [], 0
    for operands, op in ops:
        o = str(op)
        if o == "Tf": cur = str(operands[0])
        if o in ("Tj", "'", '"', "TJ") and (occurrence == "all" or count == 0):
            def fix(s):
                nonlocal count, skipped
                b = bytes(s)
                if fb not in b: return s
                if cur not in editable: skipped += 1; return s
                k = b.count(fb) if occurrence == "all" else 1
                count += k; return String(b.replace(fb, rb, k))
            if o == "TJ":
                operands = [Array([fix(x) if isinstance(x, String) else x for x in operands[0]])]
            else:
                operands = list(operands); operands[-1] = fix(operands[-1])
        out.append((operands, op))
    if count == 0:
        raise EngineError("TEXT_NOT_FOUND", "Text not found within a single editable text run",
                          {"skipped_in_non_editable_fonts": skipped, "hint": "Text split across runs/kerning is not matched"})
    pg.Contents = pdf.make_stream(pikepdf.unparse_content_stream(out))
    return _save(pdf), count


PRESETS = {"low": dict(compress_streams=True, object_stream_mode=pikepdf.ObjectStreamMode.preserve),
           "balanced": dict(compress_streams=True, object_stream_mode=pikepdf.ObjectStreamMode.generate,
                            recompress_flate=True),
           "high": dict(compress_streams=True, object_stream_mode=pikepdf.ObjectStreamMode.generate,
                        recompress_flate=True, linearize=True)}


def compress(data: bytes, preset: str = "balanced", strip_metadata: bool = False) -> tuple[bytes, dict]:
    if preset not in PRESETS: raise EngineError("INVALID_PRESET", f"preset must be one of {list(PRESETS)}")
    t = time.perf_counter(); pdf = open_pdf(data); warnings = []
    pdf.remove_unreferenced_resources()
    if strip_metadata:
        warnings.append("Document metadata removed (lossy for metadata).")
        if "/Metadata" in pdf.Root: del pdf.Root.Metadata
        for k in list(pdf.docinfo.keys()): del pdf.docinfo[k]
    out = _save(pdf, **PRESETS[preset])
    final = out
    if len(out) >= len(data):
        warnings.append("Optimization did not reduce size; original bytes kept."); final = data
    return final, {"preset": preset, "original_size": len(data), "final_size": len(final),
                   "compression_ratio": round(len(final) / len(data), 4), "duration_ms": round((time.perf_counter() - t) * 1000, 1),
                   "lossy": False, "warnings": warnings + ["Image downsampling not applied in this preset (lossless only)."]}
