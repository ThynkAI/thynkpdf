"""Content-stream text editing (insert/delete/move) and page structure ops. Real operator rewrites; no overlays."""
import pikepdf
from pikepdf import Pdf, Name, String, Array, Dictionary, Operator
from .engine import EngineError, open_pdf, capabilities, _check_pages, _save, STANDARD_14

TEXT_SHOW = {"Tj", "TJ"}


def _page_caps(data, page):
    caps = capabilities(data); _check_pages(len(caps["pages"]), [page]); return caps, caps["pages"][page - 1]


def _enc(t):
    try: return t.encode("cp1252")
    except UnicodeEncodeError: raise EngineError("EDIT_UNSUPPORTED_CHARACTERS", "Characters not representable in WinAnsi encoding")


def _run_bytes(operands, op):
    if op == "Tj": return bytes(operands[0])
    return b"".join(bytes(x) for x in operands[0] if isinstance(x, String))


def delete_text(data: bytes, page: int, find: str, occurrence="all") -> tuple[bytes, int]:
    """Removes matched glyphs from the string operand. Following glyphs in the SAME run shift left (no reflow
    beyond the run); runs that become empty are dropped."""
    from .engine import replace_text
    return replace_text(data, page, find, "", occurrence)


def move_text(data: bytes, page: int, find: str, dx: float, dy: float) -> tuple[bytes, int]:
    """Moves the whole text run (Tj/TJ operator) whose text equals or contains `find` by (dx,dy) in text space,
    by wrapping it in `dx dy Td ... -dx -dy Td`. Requires an unscaled text matrix (no Tm scaling, no cm in BT)."""
    caps, pc = _page_caps(data, page)
    if not pc["text_move"]:
        raise EngineError("EDIT_NOT_SUPPORTED", "Text on this page cannot be safely moved", {"limitations": pc["limitations"] + caps["document_limitations"]})
    fb = _enc(find)
    pdf = open_pdf(data); pg = pdf.pages[page - 1]; pg.contents_coalesce()
    ops = list(pikepdf.parse_content_stream(pg)); out, cur, moved, in_bt, scaled = [], None, 0, False, False
    for operands, op in ops:
        o = str(op)
        if o == "BT": in_bt, scaled = True, False
        elif o == "ET": in_bt = False
        elif o == "Tf": cur = str(operands[0])
        elif o == "Tm" and (abs(float(operands[0]) - 1) > 1e-6 or abs(float(operands[3]) - 1) > 1e-6 or float(operands[1]) or float(operands[2])):
            scaled = True
        if o in TEXT_SHOW and not moved and fb in _run_bytes(operands, o) and cur in pc["editable_fonts"]:
            if scaled:
                raise EngineError("EDIT_NOT_SUPPORTED", "Text run uses a scaled/rotated text matrix", {"limitations": [{"code": "TEXT_MATRIX_TRANSFORMED", "message": "Move not supported for transformed text"}]})
            out += [([dx, dy], Operator("Td")), (operands, op), ([-dx, -dy], Operator("Td"))]; moved = 1; continue
        out.append((operands, op))
    if not moved: raise EngineError("TEXT_NOT_FOUND", "No editable text run contains the text")
    pg.Contents = pdf.make_stream(pikepdf.unparse_content_stream(out))
    return _save(pdf), moved


def insert_text(data: bytes, page: int, text: str, x: float, y: float, size: float = 12, font: str = "Helvetica", rotate: int = 0) -> bytes:
    """Appends a real text object (BT .. Tj ET) using an unembedded standard-14 font in WinAnsi.
    `rotate` (0/90/180/270, counter-clockwise in user space) sets the baseline direction via Tm."""
    if font not in STANDARD_14 or font in ("Symbol", "ZapfDingbats"):
        raise EngineError("EDIT_UNSUPPORTED_FONT", "Insert supports standard-14 Latin fonts only", {"allowed": sorted(STANDARD_14 - {"Symbol", "ZapfDingbats"})})
    if not text: raise EngineError("INVALID_REQUEST", "text must be non-empty")
    if not (0 < size <= 500): raise EngineError("INVALID_REQUEST", "size out of range")
    tb = _enc(text)
    caps, pc = _page_caps(data, page)
    if caps["document_limitations"] and any(l["code"] == "SIGNED_DOCUMENT" for l in caps["document_limitations"]):
        raise EngineError("EDIT_NOT_SUPPORTED", "Signed document", {"limitations": caps["document_limitations"]})
    pdf = open_pdf(data); pg = pdf.pages[page - 1]
    if "/Resources" not in pg.obj: pg.obj.Resources = Dictionary()
    res = pg.obj.Resources
    if "/Font" not in res: res.Font = Dictionary()
    fonts = res.Font
    key = None
    for k, f in fonts.items():
        if str(f.get("/BaseFont")) == "/" + font and str(f.get("/Encoding")) == "/WinAnsiEncoding" and "/FontDescriptor" not in f: key = k
    if key is None:
        i = 1
        while f"/TPF{i}" in fonts: i += 1
        key = f"/TPF{i}"
        fonts[key] = pdf.make_indirect(Dictionary(Type=Name.Font, Subtype=Name.Type1, BaseFont=Name("/" + font), Encoding=Name.WinAnsiEncoding))
    content = pikepdf.unparse_content_stream([([], Operator("q")), ([], Operator("BT")), ([Name(key), size], Operator("Tf")),
                                              ((([x, y], Operator("Td")) if not rotate % 360 else (_rot_tm(rotate, x, y), Operator("Tm")))),
                                              ([String(tb)], Operator("Tj")), ([], Operator("ET")), ([], Operator("Q"))])
    pg.contents_add(pdf.make_stream(b"q\n"), prepend=True)  # isolate existing graphics state
    pg.contents_add(pdf.make_stream(b"Q\n" + content))
    return _save(pdf)


def _rot_tm(deg: int, x: float, y: float) -> list:
    c, s_ = {0: (1, 0), 90: (0, 1), 180: (-1, 0), 270: (0, -1)}[deg % 360]
    return [c, s_, -s_, c, x, y]


def insert_blank(data: bytes, after: int, count: int = 1, width: float | None = None, height: float | None = None) -> bytes:
    pdf = open_pdf(data); n = len(pdf.pages)
    if not (0 <= after <= n): raise EngineError("INVALID_PAGE", "after must be 0..page_count", {"page_count": n})
    if not (1 <= count <= 100): raise EngineError("INVALID_REQUEST", "count must be 1..100")
    ref = pdf.pages[max(after - 1, 0)]; mb = [float(v) for v in ref.mediabox]
    w, h = width or (mb[2] - mb[0]), height or (mb[3] - mb[1])
    for i in range(count):
        pdf.pages.insert(after + i, pikepdf.Page(pdf.make_indirect(Dictionary(Type=Name.Page, MediaBox=[0, 0, w, h], Resources=Dictionary()))))
    return _save(pdf)


def delete_pages(data: bytes, pages: list[int]) -> bytes:
    pdf = open_pdf(data); n = len(pdf.pages); _check_pages(n, pages)
    if len(set(pages)) >= n: raise EngineError("CANNOT_DELETE_ALL_PAGES", "Cannot delete every page")
    for p in sorted(set(pages), reverse=True): del pdf.pages[p - 1]
    return _save(pdf)


def duplicate_page(data: bytes, page: int, count: int = 1) -> bytes:
    pdf = open_pdf(data); _check_pages(len(pdf.pages), [page])
    if not (1 <= count <= 100): raise EngineError("INVALID_REQUEST", "count must be 1..100")
    src = pdf.pages[page - 1]
    for i in range(count):
        pdf.pages.insert(page + i, _clone_page(pdf, src))
    return _save(pdf)


def _clone_page(pdf, src):
    """Copy a page with its annotations and links (BD-09). Form widgets are not copied (a copied widget would share or
    duplicate the field); popups are dropped and re-created by viewers; reply links (/IRT) are not carried over."""
    import uuid
    cp = pdf.make_indirect(Dictionary({k: v for k, v in src.obj.items() if k not in ("/Annots", "/Parent")}))
    annots = []
    for a in (src.obj.get("/Annots") or []):
        try:
            if a.get("/Subtype") in (Name.Widget, Name.Popup): continue
            na = Dictionary({k: v for k, v in a.items() if k not in ("/P", "/Popup", "/IRT", "/Parent")})
            na[Name.P] = cp
            if "/NM" in a: na[Name.NM] = pikepdf.String(uuid.uuid4().hex)
            annots.append(pdf.make_indirect(na))
        except Exception:
            continue
    if annots: cp[Name.Annots] = pikepdf.Array(annots)
    return pikepdf.Page(cp)


def duplicate_pages(data: bytes, pages: list[int], position="after_each") -> bytes:
    """position="after_each": each copy right after its original; int N: all copies (in order) after page N (0 = start)."""
    pdf = open_pdf(data); n = len(pdf.pages); _check_pages(n, pages)
    if not pages: raise EngineError("INVALID_PAGE", "No pages selected")
    srcs = [pdf.pages[p - 1] for p in pages]
    if position == "after_each":
        for p in sorted(pages, reverse=True):
            pdf.pages.insert(p, _clone_page(pdf, pdf.pages[p - 1]))
    else:
        if not isinstance(position, int) or not 0 <= position <= n: raise EngineError("INVALID_PAGE", "position must be after_each or 0..page_count")
        clones = [_clone_page(pdf, sp) for sp in srcs]
        for i, cpg in enumerate(clones): pdf.pages.insert(position + i, cpg)
    return _save(pdf)


def insert_from(data: bytes, source: bytes, source_pages: list[int] | None, after_page: int) -> bytes:
    pdf = open_pdf(data); src = open_pdf(source); n = len(pdf.pages)
    if not 0 <= after_page <= n: raise EngineError("INVALID_PAGE", "after_page must be 0..page_count", {"page_count": n})
    sp = source_pages or list(range(1, len(src.pages) + 1)); _check_pages(len(src.pages), sp)
    for i, p in enumerate(sp):
        pdf.pages.insert(after_page + i, src.pages[p - 1])
    return _save(pdf)
