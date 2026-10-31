"""Annotations persisted into the PDF (/Annots) with generated appearance streams (/AP) so other viewers render them.
Shape follows the frontend contract (apps/web/docs/frontend-backend-requests.md §2)."""
import uuid
from datetime import datetime, timezone
import pikepdf
from pikepdf import Name, Dictionary, Array, String
from .engine import EngineError, open_pdf, _check_pages, _save

SUB = {"highlight": "/Highlight", "underline": "/Underline", "strikeout": "/StrikeOut", "ink": "/Ink", "text": "/Text",
       "freetext": "/FreeText", "square": "/Square", "circle": "/Circle", "line": "/Line", "arrow": "/Line", "stamp": "/Stamp"}
MARKUP = {"highlight", "underline", "strikeout"}
STAMPS = {"Approved", "NotApproved", "Draft", "Final", "Confidential", "ForComment", "Expired", "Experimental", "AsIs",
          "Sold", "Departmental", "ForPublicRelease", "NotForPublicRelease", "TopSecret"}


def _pdfdate(d=None):
    d = d or datetime.now(timezone.utc); return "D:" + d.strftime("%Y%m%d%H%M%S") + "Z"


def _iso(v):
    if v is None: return None
    s = str(v)
    try: return datetime.strptime(s[2:16], "%Y%m%d%H%M%S").replace(tzinfo=timezone.utc).isoformat()
    except Exception: return None


def _n(v): return round(float(v), 3)


def _color(c, default):
    c = c if c is not None else default
    if len(c) != 3 or any(not 0 <= x <= 1 for x in c): raise EngineError("INVALID_REQUEST", "color must be [r,g,b] in 0..1")
    return [float(x) for x in c]


def _rect(r, what="rect"):
    if not r or len(r) != 4: raise EngineError("INVALID_REQUEST", f"{what} = [x1,y1,x2,y2]")
    x0, y0, x1, y1 = (float(v) for v in r)
    if x0 > x1: x0, x1 = x1, x0
    if y0 > y1: y0, y1 = y1, y0
    if x1 - x0 <= 0 or y1 - y0 <= 0: raise EngineError("INVALID_REQUEST", f"{what} has zero area")
    return [x0, y0, x1, y1]


def _form(pdf, bbox, body: str, res=None):
    d = Dictionary(Type=Name.XObject, Subtype=Name.Form, BBox=bbox)
    if res is not None: d.Resources = res
    return pdf.make_stream(body.encode("latin-1"), d)


def _gs(op): return Dictionary(ExtGState=Dictionary(GS0=Dictionary(Type=Name.ExtGState, CA=op, ca=op, BM=Name.Multiply if op < 1 else Name.Normal)))


def _ellipse(x0, y0, x1, y1):
    k = 0.5523; cx, cy, rx, ry = (x0 + x1) / 2, (y0 + y1) / 2, (x1 - x0) / 2, (y1 - y0) / 2
    f = lambda *a: " ".join(f"{v:.3f}" for v in a)
    return (f"{f(cx + rx, cy)} m {f(cx + rx, cy + k*ry, cx + k*rx, cy + ry, cx, cy + ry)} c {f(cx - k*rx, cy + ry, cx - rx, cy + k*ry, cx - rx, cy)} c "
            f"{f(cx - rx, cy - k*ry, cx - k*rx, cy - ry, cx, cy - ry)} c {f(cx + k*rx, cy - ry, cx + rx, cy - k*ry, cx + rx, cy)} c")


def _esc(t: str) -> str:
    try: t.encode("cp1252")
    except UnicodeEncodeError: raise EngineError("EDIT_UNSUPPORTED_CHARACTERS", "Appearance text must be WinAnsi (Latin)")
    return t.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")


def _build(pdf, a: dict, nm: str, by_nm: dict, created=None):
    t = a.get("type")
    if t not in SUB: raise EngineError("INVALID_REQUEST", f"type must be one of {sorted(SUB)}")
    defaults = {"highlight": [1, 0.9, 0], "text": [1, 0.85, 0.2]}
    col = _color(a.get("color"), defaults.get(t, [1, 0, 0])); cs = " ".join(f"{c:.3f}" for c in col)
    op = float(a.get("opacity") if a.get("opacity") is not None else (0.4 if t == "highlight" else 1))
    if not 0 < op <= 1: raise EngineError("INVALID_REQUEST", "opacity must be in (0,1]")
    bw = float(a.get("border_width") if a.get("border_width") is not None else 1.5)
    d = Dictionary(Type=Name.Annot, Subtype=Name(SUB[t]), NM=String(nm), C=col, F=4, CA=op,
                   Contents=String(a.get("contents") or ""), T=String(a.get("author") or ""),
                   CreationDate=String(created or _pdfdate()), M=String(_pdfdate()))
    if a.get("in_reply_to"):
        parent = by_nm.get(a["in_reply_to"])
        if parent is None: raise EngineError("ANNOTATION_NOT_FOUND", "in_reply_to annotation not found", {"id": a["in_reply_to"]})
        d.IRT = parent; d.RT = Name.R
    if a.get("state") in ("open", "resolved"):
        d.StateModel = String("Review"); d.State = String("Completed" if a["state"] == "resolved" else "None")
    res = _gs(op) if op < 1 else None
    pre = "/GS0 gs " if res is not None else ""
    body = None
    if t == "ink":
        strokes = a.get("ink_list") or []
        if not strokes or any(len(s) < 2 or any(len(pt) != 2 for pt in s) for s in strokes):
            raise EngineError("INVALID_REQUEST", "ink_list = [[[x,y],[x,y],...], ...] (>=2 points per stroke)")
        xs = [pt[0] for s in strokes for pt in s]; ys = [pt[1] for s in strokes for pt in s]
        rect = [min(xs) - bw, min(ys) - bw, max(xs) + bw, max(ys) + bw]
        d.InkList = Array([Array([float(v) for pt in s for v in pt]) for s in strokes])
        body = pre + f"{cs} RG {bw} w 1 J 1 j " + " ".join(
            f"{s[0][0]} {s[0][1]} m " + " ".join(f"{pt[0]} {pt[1]} l" for pt in s[1:]) + " S" for s in strokes)
    elif t in ("line", "arrow"):
        ln = a.get("line") or a.get("rect")
        if not ln or len(ln) != 4: raise EngineError("INVALID_REQUEST", "line = [x1,y1,x2,y2]")
        x0, y0, x1, y1 = (float(v) for v in ln); d.L = [x0, y0, x1, y1]
        rect = [min(x0, x1) - 10, min(y0, y1) - 10, max(x0, x1) + 10, max(y0, y1) + 10]
        body = pre + f"{cs} RG {bw} w {x0} {y0} m {x1} {y1} l S"
        if t == "arrow":
            d.LE = Array([Name("/None"), Name.OpenArrow])
            import math
            ang = math.atan2(y1 - y0, x1 - x0); L = 8 + bw * 2
            p1 = (x1 - L * math.cos(ang - 0.45), y1 - L * math.sin(ang - 0.45)); p2 = (x1 - L * math.cos(ang + 0.45), y1 - L * math.sin(ang + 0.45))
            body += f" {p1[0]:.3f} {p1[1]:.3f} m {x1} {y1} l {p2[0]:.3f} {p2[1]:.3f} l S"
        d.BS = Dictionary(W=bw)
    else:
        rect = _rect(a.get("rect")); x0, y0, x1, y1 = rect
        if t in MARKUP:
            qp = a.get("quad_points") or [x0, y1, x1, y1, x0, y0, x1, y0]
            if len(qp) % 8: raise EngineError("INVALID_REQUEST", "quad_points length must be a multiple of 8")
            d.QuadPoints = [float(v) for v in qp]; parts = []
            for i in range(0, len(qp), 8):
                q = qp[i:i + 8]; qx0, qx1 = min(q[0::2]), max(q[0::2]); qy0, qy1 = min(q[1::2]), max(q[1::2])
                if t == "highlight": parts.append(f"{qx0} {qy0} {qx1-qx0} {qy1-qy0} re f")
                elif t == "underline": parts.append(f"{qx0} {qy0 + 1} m {qx1} {qy0 + 1} l S")
                else: parts.append(f"{qx0} {(qy0+qy1)/2} m {qx1} {(qy0+qy1)/2} l S")
            body = pre + (f"{cs} rg " if t == "highlight" else f"{cs} RG 1 w ") + " ".join(parts)
        elif t == "text":
            d.Name = Name.Comment; d.Open = False
            body = pre + f"{cs} rg 0 G 0.5 w {x0} {y0} {x1-x0} {y1-y0} re B"
        elif t == "square":
            body = pre + f"{cs} RG {bw} w {x0+bw/2} {y0+bw/2} {x1-x0-bw} {y1-y0-bw} re S"; d.BS = Dictionary(W=bw)
        elif t == "circle":
            body = pre + f"{cs} RG {bw} w " + _ellipse(x0 + bw/2, y0 + bw/2, x1 - bw/2, y1 - bw/2) + " S"; d.BS = Dictionary(W=bw)
        elif t == "freetext":
            size = float(a.get("font_size") or 12); txt = _esc(a.get("contents") or "")
            d.DA = String(f"/Helv {size} Tf {cs} rg")
            font = Dictionary(Font=Dictionary(Helv=Dictionary(Type=Name.Font, Subtype=Name.Type1, BaseFont=Name.Helvetica, Encoding=Name.WinAnsiEncoding)))
            if res is not None: font.ExtGState = res.ExtGState
            tl = " T* ".join(f"({ln}) Tj" for ln in txt.split("\n"))
            body = None
            d.AP = Dictionary(N=_form(pdf, rect, pre + f"BT /Helv {size} Tf {cs} rg {size*1.2} TL {x0+2} {y1-size} Td {tl} ET", font))
        elif t == "stamp":
            nm_ = a.get("stamp_name") or "Approved"
            if nm_ not in STAMPS: raise EngineError("INVALID_REQUEST", f"stamp_name must be one of {sorted(STAMPS)}")
            d.Name = Name("/" + nm_)
            font = Dictionary(Font=Dictionary(HelvB=Dictionary(Type=Name.Font, Subtype=Name.Type1, BaseFont=Name("/Helvetica-Bold"), Encoding=Name.WinAnsiEncoding)))
            size = min((y1 - y0) * 0.5, (x1 - x0) / max(len(nm_), 1) * 1.6)
            d.AP = Dictionary(N=_form(pdf, rect, f"{cs} RG {cs} rg 2 w {x0+1} {y0+1} {x1-x0-2} {y1-y0-2} re S BT /HelvB {size:.2f} Tf {x0+4} {y0+(y1-y0-size)/2+size*0.15:.2f} Td ({nm_.upper()}) Tj ET", font))
    d.Rect = rect
    if body is not None: d.AP = Dictionary(N=_form(pdf, rect, body, res))
    return d


def _iter(pdf):
    for pi, pg in enumerate(pdf.pages, 1):
        for i, an in enumerate(pg.obj.get("/Annots", [])):
            yield pi, i, an


def _aid(pi, i, an):
    nm = an.get("/NM"); return str(nm) if nm is not None else f"p{pi}-i{i}"


REV = {"/Highlight": "highlight", "/Underline": "underline", "/StrikeOut": "strikeout", "/Ink": "ink", "/Text": "text",
       "/FreeText": "freetext", "/Square": "square", "/Circle": "circle", "/Stamp": "stamp"}


def list_annotations(data: bytes) -> list[dict]:
    pdf = open_pdf(data); out = []; ids = {}
    for pi, i, an in _iter(pdf): ids[an.objgen] = _aid(pi, i, an)
    for pi, i, an in _iter(pdf):
        st = str(an.get("/Subtype"))
        if st in ("/Widget", "/Popup"): continue
        t = REV.get(st)
        if st == "/Line": t = "arrow" if "/LE" in an and any(str(x) != "/None" for x in an.LE) else "line"
        item = {"id": ids[an.objgen], "page": pi, "type": t or st.lstrip("/").lower(), "supported": t is not None or st == "/Line",
                "rect": [_n(v) for v in an.get("/Rect", [])], "color": [_n(v) for v in an.get("/C", [])],
                "opacity": _n(an.get("/CA", 1)), "border_width": _n(an.BS.get("/W", 1)) if "/BS" in an else None,
                "contents": str(an.get("/Contents", "")), "author": str(an.get("/T", "")),
                "created_at": _iso(an.get("/CreationDate")), "modified_at": _iso(an.get("/M")),
                "quad_points": [_n(v) for v in an.QuadPoints] if "/QuadPoints" in an else None,
                "ink_list": [[[_n(s[k]), _n(s[k + 1])] for k in range(0, len(s) - 1, 2)] for s in an.InkList] if "/InkList" in an else None,
                "line": [_n(v) for v in an.L] if "/L" in an else None,
                "stamp_name": str(an.Name)[1:] if st == "/Stamp" and "/Name" in an else None,
                "in_reply_to": ids.get(an.IRT.objgen) if "/IRT" in an else None,
                "state": ("resolved" if str(an.get("/State", "")) == "Completed" else "open") if "/StateModel" in an else None}
        out.append(item)
    return out


def apply_annotations(data: bytes, add=None, update=None, delete=None) -> tuple[bytes, list[str]]:
    """Atomic batch: delete, then update, then add (adds may reply to existing or earlier-added ids)."""
    pdf = open_pdf(data); n = len(pdf.pages)
    def index():
        m = {}
        for pi, i, an in _iter(pdf):
            if str(an.get("/Subtype")) not in ("/Widget", "/Popup"): m[_aid(pi, i, an)] = (pi, an)
        return m
    m = index()
    for aid in delete or []:
        if aid not in m: raise EngineError("ANNOTATION_NOT_FOUND", "Annotation not found", {"id": aid})
        pi, an = m[aid]; annots = pdf.pages[pi - 1].obj.Annots
        kill = {an.objgen} | ({an.Popup.objgen} if "/Popup" in an else set())
        # replies to a deleted annotation are deleted too (thread removal)
        for _, (pj, other) in m.items():
            if "/IRT" in other and other.IRT.objgen == an.objgen: kill.add(other.objgen)
        for pg in pdf.pages:
            if "/Annots" in pg.obj:
                pg.obj.Annots = Array([x for x in pg.obj.Annots if x.objgen not in kill])
    m = index()
    by_nm = {k: v[1] for k, v in m.items()}
    for u in update or []:
        aid = u.get("id")
        if aid not in m: raise EngineError("ANNOTATION_NOT_FOUND", "Annotation not found", {"id": aid})
        pi, an = m[aid]; cur = [x for x in list_annotations(_save(pdf)) if x["id"] == aid][0]
        if not cur["supported"]: raise EngineError("EDIT_NOT_SUPPORTED", f"Annotation type {cur['type']} is read-only")
        merged = {**cur, **{k: v for k, v in u.items() if v is not None}}
        if merged.get("page") != pi: raise EngineError("INVALID_REQUEST", "Moving annotations between pages is not supported; delete + add")
        new = pdf.make_indirect(_build(pdf, merged, str(an.get("/NM", aid)), by_nm, str(an.get("/CreationDate", "")) or None))
        new.P = pdf.pages[pi - 1].obj
        annots = pdf.pages[pi - 1].obj.Annots
        for j in range(len(annots)):
            if annots[j].objgen == an.objgen: annots[j] = new
        # re-point replies
        for pg in pdf.pages:
            for x in pg.obj.get("/Annots", []):
                if "/IRT" in x and x.IRT.objgen == an.objgen: x.IRT = new
        by_nm[aid] = new
    ids = []
    for a in add or []:
        _check_pages(n, [a.get("page", 0)])
        nm = "thynk-" + uuid.uuid4().hex; pg = pdf.pages[a["page"] - 1]
        an = pdf.make_indirect(_build(pdf, a, nm, by_nm)); an.P = pg.obj
        if "/Annots" not in pg.obj: pg.obj.Annots = Array()
        pg.obj.Annots.append(an); by_nm[nm] = an; ids.append(nm)
    return _save(pdf), ids
