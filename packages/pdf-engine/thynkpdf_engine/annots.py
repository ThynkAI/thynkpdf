"""Annotations persisted into the PDF (/Annots) with generated appearance streams (/AP) so any viewer renders them."""
import uuid
import pikepdf
from pikepdf import Name, Dictionary, Array, String
from .engine import EngineError, open_pdf, _check_pages, _save

KINDS = {"highlight": "/Highlight", "note": "/Text", "ink": "/Ink", "rectangle": "/Square", "ellipse": "/Circle", "line": "/Line"}
REV = {v: k for k, v in KINDS.items()}


def _num(v): return round(float(v), 3)


def _color(c):
    if not c or len(c) != 3 or any(not 0 <= x <= 1 for x in c): raise EngineError("INVALID_REQUEST", "color must be [r,g,b] in 0..1")
    return [float(x) for x in c]


def _ap(pdf, rect, body: bytes, extra_res=None):
    x0, y0, x1, y1 = rect
    d = Dictionary(Type=Name.XObject, Subtype=Name.Form, BBox=[x0, y0, x1, y1])
    if extra_res: d.Resources = extra_res
    return pdf.make_stream(body, d)


def _bezier_ellipse(x0, y0, x1, y1):
    k = 0.5523; cx, cy, rx, ry = (x0 + x1) / 2, (y0 + y1) / 2, (x1 - x0) / 2, (y1 - y0) / 2
    f = lambda *a: " ".join(f"{v:.3f}" for v in a)
    return (f"{f(cx + rx, cy)} m {f(cx + rx, cy + k*ry, cx + k*rx, cy + ry, cx, cy + ry)} c "
            f"{f(cx - k*rx, cy + ry, cx - rx, cy + k*ry, cx - rx, cy)} c {f(cx - rx, cy - k*ry, cx - k*rx, cy - ry, cx, cy - ry)} c "
            f"{f(cx + k*rx, cy - ry, cx + rx, cy - k*ry, cx + rx, cy)} c")


def _build(pdf, a: dict, nm: str):
    kind = a["type"]
    if kind not in KINDS: raise EngineError("INVALID_REQUEST", f"type must be one of {list(KINDS)}")
    col = _color(a.get("color") or ([1, 1, 0] if kind == "highlight" else [1, 0, 0]))
    cs = " ".join(f"{c:.3f}" for c in col); w = float(a.get("width", 1.5))
    d = Dictionary(Type=Name.Annot, Subtype=Name(KINDS[kind]), NM=String(nm), C=col, F=4,
                   Contents=String(a.get("contents") or ""), T=String(a.get("author") or ""))
    if kind == "ink":
        strokes = a.get("ink") or []
        if not strokes or any(len(s) < 4 or len(s) % 2 for s in strokes): raise EngineError("INVALID_REQUEST", "ink = list of [x1,y1,x2,y2,...] strokes")
        xs = [v for s in strokes for v in s[0::2]]; ys = [v for s in strokes for v in s[1::2]]
        rect = [min(xs) - w, min(ys) - w, max(xs) + w, max(ys) + w]
        d.InkList = Array([Array([float(v) for v in s]) for s in strokes])
        body = f"{cs} RG {w} w 1 J 1 j " + " ".join(
            f"{s[0]} {s[1]} m " + " ".join(f"{s[i]} {s[i+1]} l" for i in range(2, len(s), 2)) + " S" for s in strokes)
    else:
        r = a.get("rect")
        if not r or len(r) != 4 or r[0] >= r[2] or r[1] >= r[3]: raise EngineError("INVALID_REQUEST", "rect = [x0,y0,x1,y1] with x0<x1,y0<y1")
        rect = [float(v) for v in r]; x0, y0, x1, y1 = rect
        if kind == "highlight":
            d.QuadPoints = [x0, y1, x1, y1, x0, y0, x1, y0]
            body = f"/GS0 gs {cs} rg {x0} {y0} {x1-x0} {y1-y0} re f"
            d.AP = Dictionary(N=_ap(pdf, rect, body.encode(), Dictionary(ExtGState=Dictionary(GS0=Dictionary(Type=Name.ExtGState, CA=0.4, ca=0.4, BM=Name.Multiply)))))
            body = None
        elif kind == "note":
            body = f"{cs} rg 0 G 0.5 w {x0} {y0} {x1-x0} {y1-y0} re B"; d.Name = Name.Comment; d.Open = False
        elif kind == "rectangle":
            body = f"{cs} RG {w} w {x0+w/2} {y0+w/2} {x1-x0-w} {y1-y0-w} re S"; d.BS = Dictionary(W=w)
        elif kind == "ellipse":
            body = f"{cs} RG {w} w " + _bezier_ellipse(x0 + w/2, y0 + w/2, x1 - w/2, y1 - w/2) + " S"; d.BS = Dictionary(W=w)
        else:  # line from (x0,y0) to (x1,y1)
            d.L = [x0, y0, x1, y1]; body = f"{cs} RG {w} w {x0} {y0} m {x1} {y1} l S"; rect = [x0 - w, y0 - w, x1 + w, y1 + w]
    d.Rect = rect
    if body is not None: d.AP = Dictionary(N=_ap(pdf, rect, body.encode()))
    return d


def _iter(pdf):
    for pi, pg in enumerate(pdf.pages, 1):
        for i, an in enumerate(pg.obj.get("/Annots", [])):
            yield pi, i, an


def _aid(pi, i, an):
    nm = an.get("/NM"); return str(nm) if nm is not None else f"p{pi}-i{i}"


def list_annotations(data: bytes) -> list[dict]:
    pdf = open_pdf(data); out = []
    for pi, i, an in _iter(pdf):
        st = str(an.get("/Subtype"))
        if st in ("/Widget", "/Popup"): continue
        item = {"id": _aid(pi, i, an), "page": pi, "type": REV.get(st, st.lstrip("/").lower()), "subtype": st.lstrip("/"),
                "rect": [_num(v) for v in an.get("/Rect", [])], "contents": str(an.get("/Contents", "")),
                "author": str(an.get("/T", "")), "color": [_num(v) for v in an.get("/C", [])], "editable": st in REV}
        if "/InkList" in an: item["ink"] = [[_num(v) for v in s] for s in an.InkList]
        out.append(item)
    return out


def add_annotation(data: bytes, a: dict) -> tuple[bytes, str]:
    pdf = open_pdf(data); _check_pages(len(pdf.pages), [a.get("page", 0)])
    nm = "thynk-" + uuid.uuid4().hex; pg = pdf.pages[a["page"] - 1]
    an = pdf.make_indirect(_build(pdf, a, nm)); an.P = pg.obj
    if "/Annots" not in pg.obj: pg.obj.Annots = Array()
    pg.obj.Annots.append(an)
    return _save(pdf), nm


def _find(pdf, aid):
    for pi, i, an in _iter(pdf):
        if _aid(pi, i, an) == aid and str(an.get("/Subtype")) not in ("/Widget", "/Popup"): return pi, i, an
    raise EngineError("ANNOTATION_NOT_FOUND", "Annotation not found")


def update_annotation(data: bytes, aid: str, changes: dict) -> bytes:
    pdf = open_pdf(data); pi, i, an = _find(pdf, aid)
    st = str(an.Subtype)
    if st not in REV: raise EngineError("EDIT_NOT_SUPPORTED", f"Annotation subtype {st} is read-only")
    cur = {"type": REV[st], "page": pi, "rect": [float(v) for v in an.Rect], "color": [float(v) for v in an.get("/C", [1, 0, 0])],
           "contents": str(an.get("/Contents", "")), "author": str(an.get("/T", ""))}
    if "/InkList" in an: cur["ink"] = [[float(v) for v in s] for s in an.InkList]
    if "/L" in an: cur["rect"] = [float(v) for v in an.L]
    cur.update({k: v for k, v in changes.items() if v is not None})
    new = pdf.make_indirect(_build(pdf, cur, str(an.get("/NM", aid)))); new.P = pdf.pages[pi - 1].obj
    pdf.pages[pi - 1].obj.Annots[i] = new
    return _save(pdf)


def delete_annotation(data: bytes, aid: str) -> bytes:
    pdf = open_pdf(data); pi, i, an = _find(pdf, aid)
    popup = an.get("/Popup"); annots = pdf.pages[pi - 1].obj.Annots
    del annots[i]
    if popup is not None:
        for j in range(len(annots) - 1, -1, -1):
            if annots[j].objgen == popup.objgen: del annots[j]
    return _save(pdf)
