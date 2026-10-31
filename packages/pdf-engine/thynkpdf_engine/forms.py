"""AcroForm create / inspect / fill / flatten / export. Embedded JavaScript (/AA, /JS) is never executed;
calculated fields (/CO) are reported, not evaluated."""
import csv, io, re
import pikepdf
from pikepdf import Name, Dictionary, Array, String
from .engine import EngineError, open_pdf, _check_pages, _save

TYPES = {"text", "multiline", "checkbox", "radio", "dropdown", "listbox", "signature"}
F_REQUIRED, F_MULTILINE, F_RADIO, F_NOTOGGLE, F_COMBO = 1 << 1, 1 << 12, 1 << 15, 1 << 14, 1 << 17
NAME_RE = re.compile(r"^[A-Za-z0-9_\-]{1,100}$")


def _acro(pdf):
    if "/AcroForm" not in pdf.Root:
        pdf.Root.AcroForm = pdf.make_indirect(Dictionary(Fields=Array()))
    a = pdf.Root.AcroForm
    if "/Fields" not in a: a.Fields = Array()
    if "/DR" not in a: a.DR = Dictionary()
    if "/Font" not in a.DR: a.DR.Font = Dictionary()
    if "/Helv" not in a.DR.Font:
        a.DR.Font.Helv = pdf.make_indirect(Dictionary(Type=Name.Font, Subtype=Name.Type1, BaseFont=Name.Helvetica, Encoding=Name.WinAnsiEncoding))
    if "/ZaDb" not in a.DR.Font:
        a.DR.Font.ZaDb = pdf.make_indirect(Dictionary(Type=Name.Font, Subtype=Name.Type1, BaseFont=Name.ZapfDingbats))
    if "/DA" not in a: a.DA = String("/Helv 0 Tf 0 g")
    return a


def _walk(fields, prefix=""):
    for f in fields:
        t = str(f.get("/T", "")); name = f"{prefix}.{t}" if prefix and t else (t or prefix)
        kids = f.get("/Kids")
        if kids is not None and any("/T" in k for k in kids):
            yield from _walk(kids, name)
        else:
            yield name, f


def _ft(f):
    x = f
    while x is not None:
        if "/FT" in x: return str(x.FT)
        x = x.get("/Parent")
    return None


def _ff(f): return int(f.get("/Ff", 0))


def _kind(f):
    ft, ff = _ft(f), _ff(f)
    if ft == "/Tx": return "multiline" if ff & F_MULTILINE else "text"
    if ft == "/Btn": return "radio" if ff & F_RADIO else ("checkbox" if not ff & (1 << 16) else "pushbutton")
    if ft == "/Ch": return "dropdown" if ff & F_COMBO else "listbox"
    if ft == "/Sig": return "signature"
    return "unknown"


def _widgets(f): return list(f.Kids) if "/Kids" in f else [f]


def _on_states(w):
    ap = w.get("/AP"); n = ap.get("/N") if ap is not None else None
    return [str(k)[1:] for k in n.keys() if k != "/Off"] if isinstance(n, Dictionary) else []


def _options(f):
    out = []
    for o in f.get("/Opt", []):
        out.append(str(o[0]) if isinstance(o, Array) else str(o))
    return out


def list_fields(data: bytes) -> list[dict]:
    pdf = open_pdf(data); acro = pdf.Root.get("/AcroForm")
    if acro is None: return []
    page_of = {p.obj.objgen: i + 1 for i, p in enumerate(pdf.pages)}
    out = []
    for name, f in _walk(acro.get("/Fields", [])):
        k = _kind(f); v = f.get("/V")
        val = (str(v)[1:] if isinstance(v, Name) else str(v)) if v is not None else None
        if k == "checkbox": val = val not in (None, "Off")
        if k == "listbox" and isinstance(v, Array): val = [str(x) for x in v]
        w = _widgets(f)[0]
        opts = _options(f) if k in ("dropdown", "listbox") else (sorted({s for w2 in _widgets(f) for s in _on_states(w2)}) if k == "radio" else None)
        out.append({"name": name, "type": k, "value": val, "required": bool(_ff(f) & F_REQUIRED),
                    "read_only": bool(_ff(f) & 1), "options": opts, "max_length": int(f["/MaxLen"]) if "/MaxLen" in f else None,
                    "page": page_of.get(w.get("/P").objgen) if w.get("/P") is not None else None,
                    "rect": [round(float(x), 2) for x in w.get("/Rect", [])],
                    "has_actions": "/AA" in f or "/A" in w or "/AA" in w,
                    "calculated": name in {str(c.get("/T", "")) for c in acro.get("/CO", [])}})
    return out


def _check_ap(pdf, rect, on_name, glyph):
    x0, y0, x1, y1 = [float(v) for v in rect]; w, h = x1 - x0, y1 - y0; s = min(w, h) * 0.8
    res = Dictionary(Font=Dictionary(ZaDb=pdf.Root.AcroForm.DR.Font.ZaDb))
    on = pdf.make_stream(f"q 0 g BT /ZaDb {s:.2f} Tf {(w - s*0.75)/2:.2f} {(h - s*0.7)/2:.2f} Td ({glyph}) Tj ET Q".encode(),
                         Dictionary(Type=Name.XObject, Subtype=Name.Form, BBox=[0, 0, w, h], Resources=res))
    off = pdf.make_stream(b"", Dictionary(Type=Name.XObject, Subtype=Name.Form, BBox=[0, 0, w, h]))
    border = pdf.make_stream(b"", Dictionary(Type=Name.XObject, Subtype=Name.Form, BBox=[0, 0, w, h]))
    return Dictionary(N=Dictionary({"/" + on_name: on, "/Off": off}), D=Dictionary({"/" + on_name: border, "/Off": off}))


def create_fields(data: bytes, fields: list[dict]) -> bytes:
    pdf = open_pdf(data); acro = _acro(pdf)
    existing = {n for n, _ in _walk(acro.Fields)}
    for spec in fields:
        name, kind = spec.get("name", ""), spec.get("type")
        if not NAME_RE.match(name): raise EngineError("INVALID_REQUEST", "field name must match [A-Za-z0-9_-]{1,100}", {"name": name})
        if kind not in TYPES: raise EngineError("INVALID_REQUEST", f"type must be one of {sorted(TYPES)}")
        if name in existing: raise EngineError("FORM_FIELD_EXISTS", "Field name already exists", {"name": name})
        _check_pages(len(pdf.pages), [spec.get("page", 0)]); pg = pdf.pages[spec["page"] - 1]
        ff = F_REQUIRED if spec.get("required") else 0
        mk_w = lambda rect: Dictionary(Type=Name.Annot, Subtype=Name.Widget, Rect=[float(v) for v in rect], P=pg.obj, F=4,
                                       MK=Dictionary(BC=[0, 0, 0], BG=[1, 1, 1]), BS=Dictionary(W=1))
        rect = spec.get("rect")
        if kind != "radio" and (not rect or len(rect) != 4 or rect[0] >= rect[2] or rect[1] >= rect[3]):
            raise EngineError("INVALID_REQUEST", "rect = [x0,y0,x1,y1]", {"name": name})
        f = None
        if kind in ("text", "multiline"):
            f = mk_w(rect); f.FT = Name.Tx; f.DA = String(f"/Helv {float(spec.get('font_size', 10))} Tf 0 g")
            if kind == "multiline": ff |= F_MULTILINE
            if spec.get("max_length"): f.MaxLen = int(spec["max_length"])
            if spec.get("default") is not None: f.V = String(str(spec["default"])); f.DV = String(str(spec["default"]))
        elif kind == "checkbox":
            f = mk_w(rect); f.FT = Name.Btn; f.AP = _check_ap(pdf, rect, "Yes", "4")
            on = bool(spec.get("default")); f.V = Name.Yes if on else Name.Off; f.AS = f.V
            f.MK.CA = String("4")
        elif kind in ("dropdown", "listbox"):
            opts = spec.get("options") or []
            if not opts: raise EngineError("INVALID_REQUEST", "options required", {"name": name})
            f = mk_w(rect); f.FT = Name.Ch; f.Opt = Array([String(str(o)) for o in opts]); f.DA = String("/Helv 10 Tf 0 g")
            if kind == "dropdown": ff |= F_COMBO
            if spec.get("default") is not None:
                if spec["default"] not in opts: raise EngineError("INVALID_REQUEST", "default not in options")
                f.V = String(spec["default"])
        elif kind == "radio":
            opts = spec.get("options") or []; rects = spec.get("rects") or []
            if len(opts) < 2 or len(opts) != len(rects) or any(not NAME_RE.match(o) for o in opts):
                raise EngineError("INVALID_REQUEST", "radio needs >=2 options (names) and one rect per option", {"name": name})
            f = Dictionary(FT=Name.Btn, Kids=Array()); ff |= F_RADIO | F_NOTOGGLE
            default = spec.get("default"); f.V = Name("/" + default) if default in opts else Name.Off
            for o, r in zip(opts, rects):
                w = pdf.make_indirect(mk_w(r)); w.AP = _check_ap(pdf, r, o, "l"); w.AS = Name("/" + o) if o == default else Name.Off
                w.MK.CA = String("l"); f.Kids.append(w)
        elif kind == "signature":
            f = mk_w(rect); f.FT = Name.Sig
        f.T = String(name)
        if ff: f.Ff = ff
        if spec.get("read_only"): f.Ff = int(f.get("/Ff", 0)) | 1
        f = pdf.make_indirect(f); acro.Fields.append(f); existing.add(name)
        if "/Annots" not in pg.obj: pg.obj.Annots = Array()
        for w in _widgets(f):
            if kind == "radio": w.Parent = f
            pg.obj.Annots.append(w)
    acro.NeedAppearances = True
    pdf.generate_appearance_streams()
    acro.NeedAppearances = False
    return _save(pdf)


def fill_fields(data: bytes, values: dict) -> tuple[bytes, dict]:
    pdf = open_pdf(data); acro = pdf.Root.get("/AcroForm")
    if acro is None: raise EngineError("FORM_FIELD_NOT_FOUND", "Document has no form")
    byname = dict(_walk(acro.get("/Fields", [])))
    unknown = [k for k in values if k not in byname]
    if unknown: raise EngineError("FORM_FIELD_NOT_FOUND", "Unknown fields", {"fields": unknown})
    errors = {}
    for name, val in values.items():
        f = byname[name]; k = _kind(f)
        if _ff(f) & 1: errors[name] = "read_only"; continue
        if k in ("text", "multiline"):
            s = "" if val is None else str(val)
            if "/MaxLen" in f and len(s) > int(f.MaxLen): errors[name] = "max_length"; continue
            f.V = String(s)
        elif k == "checkbox":
            if not isinstance(val, bool): errors[name] = "expected_boolean"; continue
            on = (_on_states(_widgets(f)[0]) or ["Yes"])[0]
            f.V = Name("/" + on) if val else Name.Off
            for w in _widgets(f): w.AS = f.V
        elif k == "radio":
            states = {s for w in _widgets(f) for s in _on_states(w)}
            if val not in states: errors[name] = "invalid_option"; continue
            f.V = Name("/" + val)
            for w in _widgets(f): w.AS = Name("/" + val) if val in _on_states(w) else Name.Off
        elif k in ("dropdown", "listbox"):
            opts = _options(f); vals = val if isinstance(val, list) else [val]
            if any(v not in opts for v in vals): errors[name] = "invalid_option"; continue
            f.V = String(vals[0]) if len(vals) == 1 else Array([String(v) for v in vals])
        else:
            errors[name] = f"unsupported_type:{k}"
    if errors: raise EngineError("VALIDATION_ERROR", "Invalid form values", {"fields": errors})
    for f in byname.values():
        if _kind(f) in ("text", "multiline", "dropdown", "listbox"):
            for w in _widgets(f):
                if "/AP" in w: del w["/AP"]  # force regeneration for changed values
    acro.NeedAppearances = True
    pdf.generate_appearance_streams(); acro.NeedAppearances = False
    out = _save(pdf)
    missing = [f["name"] for f in list_fields(out) if f["required"] and f["value"] in (None, "", False)]
    return out, {"filled": list(values), "missing_required": missing}


def flatten(data: bytes) -> bytes:
    """Burns widget appearances into page content and removes the interactive form (irreversible in this version)."""
    pdf = open_pdf(data)
    if "/AcroForm" not in pdf.Root: raise EngineError("FORM_FIELD_NOT_FOUND", "Document has no form")
    pdf.Root.AcroForm.NeedAppearances = True
    pdf.generate_appearance_streams()
    pdf.flatten_annotations(mode="all")
    if "/AcroForm" in pdf.Root: del pdf.Root["/AcroForm"]
    return _save(pdf)


def export_values(data: bytes, fmt: str = "json"):
    rows = [{"name": f["name"], "type": f["type"], "value": f["value"]} for f in list_fields(data) if f["type"] != "signature"]
    if fmt == "json": return {r["name"]: r["value"] for r in rows}
    buf = io.StringIO(); w = csv.writer(buf); w.writerow(["name", "type", "value"])
    for r in rows:
        v = r["value"]; v = "|".join(v) if isinstance(v, list) else ("true" if v is True else "false" if v is False else (v or ""))
        if isinstance(v, str) and v[:1] in ("=", "+", "-", "@"): v = "'" + v  # CSV formula-injection guard
        w.writerow([r["name"], r["type"], v])
    return buf.getvalue()


def parse_csv_values(text: str, fields: list[dict]) -> dict:
    kinds = {f["name"]: f["type"] for f in fields}; out = {}
    for row in csv.DictReader(io.StringIO(text)):
        n, v = row.get("name"), row.get("value", "")
        if n is None: raise EngineError("INVALID_REQUEST", "CSV needs columns name,value")
        k = kinds.get(n)
        out[n] = (v.lower() == "true") if k == "checkbox" else (v.split("|") if k == "listbox" and "|" in v else v)
    return out


def delete_fields(data: bytes, names: list[str]) -> bytes:
    pdf = open_pdf(data); acro = pdf.Root.get("/AcroForm")
    if acro is None: raise EngineError("FORM_FIELD_NOT_FOUND", "Document has no form", {"fields": names})
    byname = dict(_walk(acro.get("/Fields", [])))
    missing = [n for n in names if n not in byname]
    if missing: raise EngineError("FORM_FIELD_NOT_FOUND", "Unknown fields", {"fields": missing})
    kill = set()
    for n in names:
        f = byname[n]; kill.add(f.objgen); kill |= {w.objgen for w in _widgets(f)}
    def prune(arr):
        out = Array()
        for x in arr:
            if x.objgen in kill: continue
            if "/Kids" in x and "/T" in x: x.Kids = prune(x.Kids)
            out.append(x)
        return out
    acro.Fields = prune(acro.Fields)
    for pg in pdf.pages:
        if "/Annots" in pg.obj: pg.obj.Annots = Array([x for x in pg.obj.Annots if x.objgen not in kill])
    return _save(pdf)
