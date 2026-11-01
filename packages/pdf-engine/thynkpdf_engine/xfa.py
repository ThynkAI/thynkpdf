"""XFA (XML Forms Architecture) support: detect, read, fill, template schema, XML import/export, and
conversion to AcroForm (static/hybrid by stripping XFA; dynamic by generating pages + widgets from the template).

Security model: PDF content is untrusted. XFA scripts (FormCalc / JavaScript) are NEVER executed; they are only
counted. Every XML packet is size-limited, first checked with defusedxml (DTDs, entity declarations and external
references are rejected), then parsed with lxml with resolve_entities=False, no_network=True, load_dtd=False.
Original code; no AGPL dependencies."""
import io, re, zlib
import defusedxml.ElementTree as DET
from defusedxml import DefusedXmlException
from xml.etree.ElementTree import ParseError
from lxml import etree
import pikepdf
from pikepdf import Name, Array, String, Dictionary
from .engine import EngineError, open_pdf, _save

MAX_PACKET = 32 * 1024 * 1024   # real forms: SF-86 template is 14 MB
MAX_TOTAL = 64 * 1024 * 1024
MAX_NODES = 2_000_000
MAX_DEPTH = 64
XFA_DATA_NS = "http://www.xfa.org/schema/xfa-data/1.0/"
XDP_NS = "http://ns.adobe.com/xdp/"
XHTML_NS = "http://www.w3.org/1999/xhtml"
_SCRIPT_RE = re.compile(rb"<(?:[A-Za-z_][\w.-]*:)?script[\s>/]")
_PKT_RE = re.compile(rb"<(?:[A-Za-z_][\w.-]*:)?(template|datasets|config|localeSet|xmpmeta|connectionSet|form|stylesheet|xfdf|sourceSet|signature|PDFSecurity|pdf)[\s>/]")
_PARSER = etree.XMLParser(resolve_entities=False, no_network=True, load_dtd=False, dtd_validation=False,
                          huge_tree=False, remove_comments=False)


def _ln(e):
    return etree.QName(e).localname if isinstance(e.tag, str) else None


# ---------- low level: reading packets ----------
def _read_stream(s) -> bytes:
    """Decode a stream with a hard cap so a compression bomb can't exhaust memory."""
    filt = s.get("/Filter")
    if filt is None:
        b = s.read_raw_bytes()
    elif (filt == Name.FlateDecode or (isinstance(filt, Array) and len(filt) == 1 and filt[0] == Name.FlateDecode)) and "/DecodeParms" not in s:
        d = zlib.decompressobj()
        try: b = d.decompress(s.read_raw_bytes(), MAX_PACKET + 1)
        except zlib.error: raise EngineError("XFA_MALFORMED", "XFA stream cannot be decompressed")
    else:
        if "/Length" in s and int(s.Length) > MAX_PACKET: raise EngineError("XFA_TOO_LARGE", "XFA packet exceeds size limit", {"limit_bytes": MAX_PACKET})
        b = s.read_bytes()
    if len(b) > MAX_PACKET: raise EngineError("XFA_TOO_LARGE", "XFA packet exceeds size limit", {"limit_bytes": MAX_PACKET})
    return b


def _xfa_obj(pdf):
    acro = pdf.Root.get("/AcroForm")
    return None if acro is None else acro.get("/XFA")


def raw_packets(pdf):
    """[(name, bytes)] in document order. form='array' or 'stream'."""
    x = _xfa_obj(pdf)
    if x is None: return None, []
    out, total = [], 0
    if isinstance(x, pikepdf.Stream):
        b = _read_stream(x); return "stream", [("xdp", b)]
    if isinstance(x, Array):
        items = list(x)
        if len(items) % 2: raise EngineError("XFA_MALFORMED", "XFA array must contain name/stream pairs")
        for i in range(0, len(items), 2):
            if not isinstance(items[i + 1], pikepdf.Stream): raise EngineError("XFA_MALFORMED", "XFA array entry is not a stream")
            b = _read_stream(items[i + 1]); total += len(b)
            if total > MAX_TOTAL: raise EngineError("XFA_TOO_LARGE", "XFA exceeds total size limit", {"limit_bytes": MAX_TOTAL})
            out.append((str(items[i]), b))
        return "array", out
    raise EngineError("XFA_MALFORMED", "/XFA must be a stream or an array")


def _wrapper(name: str, b: bytes) -> bool:
    """Array entries that only carry the <xdp:xdp> open/close tags. Adobe names them 'preamble'/'postamble'
    or literally 'xdp:xdp' and '</xdp:xdp>' (USCIS, OPM forms)."""
    if name in ("preamble", "postamble") or name.startswith("xdp:") or name.startswith("</") or not b.strip(): return True
    t = re.sub(rb"<\?xml[^>]*\?>", b"", b).strip()
    return t.startswith(b"</") or (t.startswith(b"<xdp:xdp") and not t.rstrip().endswith(b"</xdp:xdp>"))


def safe_parse(b: bytes):
    if len(b) > MAX_PACKET: raise EngineError("XFA_TOO_LARGE", "XML exceeds size limit", {"limit_bytes": MAX_PACKET})
    try:
        DET.fromstring(b, forbid_dtd=True, forbid_entities=True, forbid_external=True)
    except DefusedXmlException as e:
        raise EngineError("XFA_UNSAFE_XML", "XFA XML contains a DTD, entity declaration or external reference and was rejected",
                          {"reason": type(e).__name__})
    except (ParseError, ValueError) as e:
        raise EngineError("XFA_MALFORMED", "XFA XML is not well-formed", {"reason": str(e)[:200]})
    try:
        root = etree.fromstring(b, parser=_PARSER)
    except etree.XMLSyntaxError as e:
        raise EngineError("XFA_MALFORMED", "XFA XML is not well-formed", {"reason": str(e)[:200]})
    n = 0
    for _ in root.iter():
        n += 1
        if n > MAX_NODES: raise EngineError("XFA_TOO_LARGE", "XFA XML has too many nodes", {"limit_nodes": MAX_NODES})
    return root


def _packets_xml(pdf) -> tuple[str | None, dict]:
    """{packet_name: lxml element}. For single-stream XDP the root children are the packets."""
    form, raws = raw_packets(pdf)
    if form is None: return None, {}
    if form == "stream":
        root = safe_parse(raws[0][1])
        return form, {_ln(c): c for c in root if _ln(c)}
    out = {}
    for name, b in raws:
        if _wrapper(name, b): continue
        out[name] = safe_parse(b)
    return form, out


def _set_packet(pdf, name: str, elem):
    """Replace (or add) a packet in place, keeping the /XFA layout (array or single stream)."""
    x = _xfa_obj(pdf); new = etree.tostring(elem, encoding="utf-8")
    if isinstance(x, pikepdf.Stream):
        root = safe_parse(_read_stream(x))
        old = next((c for c in root if _ln(c) == name), None)
        if old is not None: root.replace(old, elem)
        else: root.append(elem)
        x.write(etree.tostring(root, encoding="utf-8", xml_declaration=True)); return
    items = list(x)
    for i in range(0, len(items), 2):
        if str(items[i]) == name:
            items[i + 1].write(new); return
    pos = next((i for i in range(0, len(items), 2) if str(items[i]) == "postamble"), len(items))
    x.insert(pos, String(name)); x.insert(pos + 1, pdf.make_stream(new))


# ---------- detection ----------
def _widget_count(pdf):
    acro = pdf.Root.get("/AcroForm"); n = 0
    if acro is None: return 0
    stack = list(acro.get("/Fields", []))
    while stack and n < 100000:
        f = stack.pop()
        if "/Kids" in f: stack.extend(f.Kids)
        if f.get("/Subtype") == Name.Widget or "/Rect" in f: n += 1
    return n


def detect_pdf(pdf) -> dict:
    x = _xfa_obj(pdf)
    if x is None: return {"present": False, "kind": "none", "form": None, "packets": [], "has_scripts": False,
                          "script_count": 0, "needs_rendering": False, "acroform_widgets": _widget_count(pdf), "xml_safe": None}
    form, raws = raw_packets(pdf)
    blob = b"".join(b for _, b in raws)
    if form == "array": names = [n for n, b in raws if not _wrapper(n, b)]
    else:
        try: names = [_ln(c) for c in safe_parse(raws[0][1]) if _ln(c)]
        except EngineError: names = list(dict.fromkeys(m.decode() for m in _PKT_RE.findall(raws[0][1])))
    xml_safe = True
    for n, b in raws:
        if _wrapper(n, b): continue
        try: safe_parse(b)
        except EngineError: xml_safe = False
    nr = bool(pdf.Root.get("/NeedsRendering", False)); w = _widget_count(pdf)
    scripts = len(_SCRIPT_RE.findall(blob))
    return {"present": True, "kind": "dynamic" if nr or w == 0 else "hybrid", "form": form, "packets": names,
            "has_scripts": scripts > 0, "script_count": scripts, "needs_rendering": nr, "acroform_widgets": w, "xml_safe": xml_safe}


def detect(data: bytes) -> dict:
    return detect_pdf(open_pdf(data))


# ---------- datasets ----------
def _data_root(pkts, create=False):
    ds = pkts.get("datasets")
    if ds is None:
        if not create: return None, None
        ds = etree.Element(f"{{{XFA_DATA_NS}}}datasets", nsmap={"xfa": XFA_DATA_NS})
    data = next((c for c in ds if _ln(c) == "data"), None)
    if data is None:
        if not create: return ds, None
        data = etree.SubElement(ds, f"{{{XFA_DATA_NS}}}data")
    return ds, data


def _flatten_data(data):
    """Leaf elements under xfa:data → [(path, value)]. Repeated siblings get [n] for n>=1."""
    out = []
    def rec(e, path, depth):
        if depth > MAX_DEPTH: raise EngineError("XFA_TOO_LARGE", "XFA data nesting too deep")
        kids = [c for c in e if isinstance(c.tag, str)]
        rich = e.get(f"{{{XFA_DATA_NS}}}contentType") == "text/html" or any(etree.QName(c).namespace == XHTML_NS for c in kids)
        if rich:  # rich text value (XHTML <body>): exposed as its plain text
            out.append((path, "\n".join(t.strip() for t in e.itertext() if t.strip()))); return
        if not kids:
            out.append((path, e.text or "")); return
        seen = {}
        for c in kids:
            n = _esc(_ln(c)); i = seen.get(n, 0); seen[n] = i + 1
            rec(c, f"{path}.{n}" + (f"[{i}]" if i else ""), depth + 1)
    seen = {}
    for c in data:
        if not isinstance(c.tag, str): continue
        n = _esc(_ln(c)); i = seen.get(n, 0); seen[n] = i + 1
        rec(c, n + (f"[{i}]" if i else ""), 1)
    return out


_SEG = re.compile(r"^([^\[\]]+)(?:\[(\d+)\])?$")
_DOT = re.compile(r"(?<!\\)\.")


def _esc(n: str) -> str:
    """Data/SOM path segment escaping: a literal '.' inside an element name is written '\\.' (as Designer does)."""
    return n.replace(".", "\\.")


def _split(path: str) -> list[str]:
    return _DOT.split(path)


def _find_node(data, path, create=False):
    cur = data
    for seg in _split(path):
        m = _SEG.match(seg)
        if not m: raise EngineError("VALIDATION_ERROR", "Invalid XFA data path", {"path": path})
        n, i = m.group(1).replace("\\.", "."), int(m.group(2) or 0)
        kids = [c for c in cur if isinstance(c.tag, str) and _ln(c) == n]
        if i < len(kids): cur = kids[i]; continue
        if not create or i != len(kids): return None
        if not re.match(r"^[A-Za-z_][\w.-]*$", n): raise EngineError("VALIDATION_ERROR", "Invalid XFA element name", {"path": path})
        cur = etree.SubElement(cur, n)
    return cur


def norm_acro(name: str) -> str:
    return re.sub(r"\[0\]", "", name)


def _schema_index(pkts, values):
    """Template fields keyed both ways. Never raises on template quirks (returns empty)."""
    if "template" not in pkts: return []
    try: return _template_fields(pkts["template"], values)[0]
    except EngineError as e:
        if e.code in ("XFA_TOO_LARGE",): raise
        return []


def _radio_states(pdf, acro_name):
    """On-state names of a radio's widgets in kid order (matches exclGroup child order)."""
    from .forms import _walk, _widgets, _on_states
    acro = pdf.Root.get("/AcroForm")
    for n, f in _walk(acro.get("/Fields", []) if acro is not None else []):
        if n == acro_name: return [(_on_states(w) or [None])[0] for w in _widgets(f)]
    return []


class _Ctx:
    """Everything needed to translate between XFA data paths and AcroForm fields for one document version."""
    def __init__(self, data_bytes):
        from .forms import list_fields
        self.pdf = open_pdf(data_bytes); self.info = detect_pdf(self.pdf)
        if not self.info["present"]: raise EngineError("XFA_NOT_PRESENT", "Document has no XFA form")
        _, self.pkts = _packets_xml(self.pdf)
        _, data = _data_root(self.pkts)
        self.values = dict(_flatten_data(data)) if data is not None else {}
        self.schema = _schema_index(self.pkts, self.values)
        self.acro = {f["name"]: f for f in list_fields(data_bytes)} if self.info["kind"] == "hybrid" else {}
        self.by_som = {f["som"]: f for f in self.schema}
        self.by_path = {}
        for f in self.schema:
            if f.get("name"): self.by_path.setdefault(f["name"], f)
        self.d2a, self.a2d = {}, {}
        for f in self.schema:
            if f.get("name") and f["som"] in self.acro:
                self.d2a.setdefault(f["name"], f["som"]); self.a2d[f["som"]] = f["name"]
        for a in self.acro:  # legacy fallback: strip [0] indexes
            if a not in self.a2d and norm_acro(a) in self.values: self.a2d[a] = norm_acro(a); self.d2a.setdefault(norm_acro(a), a)

    def resolve(self, key):
        """→ (data_path | None, acro_name | None, schema_field | None)"""
        if key in self.acro:
            return self.a2d.get(key), key, self.by_som.get(key)
        if key in self.by_som:
            f = self.by_som[key]; return f.get("name"), None, f
        if key in self.by_path or key in self.values:
            return key, self.d2a.get(key), self.by_path.get(key)
        nk = norm_acro(key)
        if nk in self.values or nk in self.by_path: return nk, self.d2a.get(nk), self.by_path.get(nk)
        return None, None, None


def _truthy(v, on):
    if isinstance(v, bool): return v
    s = "" if v is None else str(v)
    return s == str(on) or s.lower() in ("1", "true", "yes", "on", "y")


def _off_value(f):
    return "0"


def _xml_value(v):
    if v is True: return "1"
    if v is False: return "0"
    if v is None: return ""
    if isinstance(v, list): return " ".join(str(x) for x in v)
    return str(v)


def _data_value(f, v, ctx=None, acro_name=None):
    """Value written into datasets for schema field f."""
    if f is None: return _xml_value(v)
    if f["type"] == "checkbox": return str(f.get("on_value") or "1") if _truthy(v, f.get("on_value")) else _off_value(f)
    if f["type"] == "radio" and ctx is not None and acro_name and v not in (f.get("options") or []):
        st = _radio_states(ctx.pdf, acro_name)
        if v in st and st.index(v) < len(f["options"]): return f["options"][st.index(v)]
    return _xml_value(v)


def _acro_value(ctx, acro_name, f, v):
    """Value for the AcroForm side, translated from an XFA value when needed."""
    af = ctx.acro[acro_name]; t = af["type"]
    if t == "checkbox": return _truthy(v, (f or {}).get("on_value"))
    if t == "radio":
        st = _radio_states(ctx.pdf, acro_name)
        if v in st: return v
        if f and v in (f.get("options") or []):
            i = f["options"].index(v)
            if i < len(st): return st[i]
        return v
    if t in ("dropdown", "listbox") and f and v not in (af.get("options") or []) and v in (f.get("options") or []):
        caps = f.get("option_captions") or []; i = f["options"].index(v)
        if i < len(caps) and caps[i] in (af.get("options") or []): return caps[i]
    return "" if v is None else (v if isinstance(v, (bool, list)) else str(v))


def strip_usage_rights(pdf) -> bool:
    """Reader Extensions (/Perms /UR3) are a signature over the original bytes; any edit invalidates them and
    Adobe Reader then shows an error and disables features. Remove them when we modify the file."""
    perms = pdf.Root.get("/Perms"); removed = False
    if perms is not None:
        for k in ("/UR3", "/UR"):
            if k in perms: del perms[k]; removed = True
        if len(perms.keys()) == 0: del pdf.Root["/Perms"]
    return removed


def _drop_form_state(pdf):
    """The 'form' packet caches merged form state with a checksum; after a data change it is stale."""
    x = _xfa_obj(pdf)
    if isinstance(x, Array):
        items = list(x)
        for i in range(0, len(items), 2):
            if str(items[i]) == "form":
                del x[i]; del x[i]; return True
    return False


def _finish(pdf, rep):
    rep["usage_rights_removed"] = strip_usage_rights(pdf)
    rep["form_state_packet_removed"] = _drop_form_state(pdf)
    return _save(pdf), rep


def read_data(data_bytes: bytes) -> dict:
    ctx = _Ctx(data_bytes)
    return {"xfa": ctx.info, "fields": [{"name": p, "value": v, "acroform_field": ctx.d2a.get(p)} for p, v in ctx.values.items()]}


def _write(ctx, plan_data, acro_vals):
    """plan_data: {data_path: str}; acro_vals: {acro_name: value}. Returns new bytes (not finished)."""
    from .forms import fill_fields
    rep = {}
    if acro_vals:
        b, r = fill_fields(_save(ctx.pdf), acro_vals); rep["missing_required"] = r.get("missing_required", [])
        ctx.pdf = open_pdf(b); _, ctx.pkts = _packets_xml(ctx.pdf)
    ds, data = _data_root(ctx.pkts, create=True)
    for path, v in plan_data.items():
        node = _find_node(data, path, create=True)
        for c in list(node): node.remove(c)
        node.attrib.pop(f"{{{XFA_DATA_NS}}}contentType", None)  # rich text replaced by plain text
        node.text = v
    if plan_data: _set_packet(ctx.pdf, "datasets", ds)
    return rep


def fill(data_bytes: bytes, values: dict) -> tuple[bytes, dict]:
    """Hybrid: AcroForm + datasets both written. Dynamic: datasets only (missing nodes are created)."""
    if not values: raise EngineError("VALIDATION_ERROR", "values is empty")
    ctx = _Ctx(data_bytes)
    acro_vals, plan, unknown, unbound = {}, {}, [], []
    for k, v in values.items():
        path, an, f = ctx.resolve(k)
        if path is None and an is None:
            (unbound if f is not None else unknown).append(k); continue
        if an: acro_vals[an] = _acro_value(ctx, an, f, v)
        if path: plan[path] = _data_value(f, v, ctx, an)
    if unknown: raise EngineError("FORM_FIELD_NOT_FOUND", "Unknown XFA fields", {"fields": unknown})
    if unbound and not acro_vals and not plan:
        raise EngineError("VALIDATION_ERROR", "Fields are not bound to data (bind match=none) and have no AcroForm widget", {"fields": unbound})
    rep = {"filled": list(values), "kind": ctx.info["kind"], "acroform_updated": sorted(acro_vals), "datasets_updated": sorted(plan),
           "not_bound": unbound}
    rep.update(_write(ctx, plan, acro_vals))
    return _finish(ctx.pdf, rep)


def sync_datasets_from_acro(data_bytes: bytes, names) -> bytes:
    """After an AcroForm fill on a hybrid doc, mirror the values into datasets so viewers agree."""
    ctx = _Ctx(data_bytes)
    if ctx.info["kind"] != "hybrid": return data_bytes
    plan = {}
    for n in names:
        if n in ctx.acro and ctx.a2d.get(n):
            plan[ctx.a2d[n]] = _data_value(ctx.by_som.get(n), ctx.acro[n]["value"], ctx, n)
    _write(ctx, plan, {}); return _finish(ctx.pdf, {})[0]


def export_xml(data_bytes: bytes) -> bytes:
    pdf = open_pdf(data_bytes)
    if _xfa_obj(pdf) is None: raise EngineError("XFA_NOT_PRESENT", "Document has no XFA form")
    _, pkts = _packets_xml(pdf); ds, _ = _data_root(pkts, create=True)
    return etree.tostring(ds, encoding="utf-8", xml_declaration=True)


def import_xml(data_bytes: bytes, xml: bytes, mode: str = "merge") -> tuple[bytes, dict]:
    """Accepts <xfa:datasets>, <xfa:data>, or a bare record element.
    mode=merge (default): only the leaf values present in the XML are written; everything else is kept.
    mode=replace: the datasets packet is replaced wholesale. Hybrid docs also get matching AcroForm values."""
    if mode not in ("merge", "replace"): raise EngineError("VALIDATION_ERROR", "mode must be merge or replace")
    ctx = _Ctx(data_bytes)
    root = safe_parse(xml)
    if _ln(root) == "datasets": ds = root
    else:
        ds = etree.Element(f"{{{XFA_DATA_NS}}}datasets", nsmap={"xfa": XFA_DATA_NS})
        if _ln(root) == "data": ds.append(root)
        else: etree.SubElement(ds, f"{{{XFA_DATA_NS}}}data").append(root)
    data = next((c for c in ds if _ln(c) == "data"), None)
    if data is None: raise EngineError("VALIDATION_ERROR", "datasets XML has no xfa:data element")
    rows = _flatten_data(data)
    acro_vals = {}
    for p, v in rows:
        an = ctx.d2a.get(p); af = ctx.acro.get(an) if an else None
        if not af or af["read_only"] or af["type"] in ("signature", "pushbutton", "unknown"): continue
        av = _acro_value(ctx, an, ctx.by_som.get(an), v)
        if af["type"] in ("radio", "dropdown", "listbox") and av not in (af["options"] or []): continue
        acro_vals[an] = av
    if mode == "replace":
        rep = _write(ctx, {}, acro_vals)
        _set_packet(ctx.pdf, "datasets", ds)
    else:
        rep = _write(ctx, {p: v for p, v in rows}, acro_vals)
    rep.update({"imported": len(rows), "mode": mode, "kind": ctx.info["kind"], "acroform_updated": sorted(acro_vals)})
    return _finish(ctx.pdf, rep)


# ---------- template ----------
_MEAS = re.compile(r"^\s*(-?\d+(?:\.\d+)?|-?\.\d+)\s*(in|mm|cm|pt|mp|px)?\s*$")


def meas(s, default=None):
    if s is None: return default
    m = _MEAS.match(s)
    if not m: return default
    v, u = float(m.group(1)), m.group(2) or "in"
    return v * {"in": 72, "mm": 72 / 25.4, "cm": 72 / 2.54, "pt": 1, "mp": 0.001, "px": 1}[u]


def _child(e, name):
    return next((c for c in e if _ln(c) == name), None) if e is not None else None


def _text_of(e):
    if e is None: return None
    t = "".join(e.itertext()).strip()
    return t or None


def _caption(f):
    c = _child(f, "caption")
    if c is None: return None, "left", None
    txt = _text_of(_child(c, "value"))
    return txt, c.get("placement", "left"), meas(c.get("reserve"))


def _items(f):
    its = [c for c in f if _ln(c) == "items"]
    disp = [(_text_of(x) or "") for x in its[0] if isinstance(x.tag, str)] if its else []
    save = None
    for it in its:
        if it.get("save") == "1": save = [(_text_of(x) or "") for x in it if isinstance(x.tag, str)]
    return disp, save


UI_TYPES = {"textEdit": "text", "numericEdit": "numeric", "dateTimeEdit": "date", "checkButton": "checkbox",
            "choiceList": "choice", "signature": "signature", "button": "button", "imageEdit": "image",
            "barcode": "barcode", "passwordEdit": "password", "defaultUi": "text"}
CONTAINERS = {"subform", "area", "subformSet", "exclGroup", "field", "draw"}


def _ui(f):
    ui = _child(f, "ui")
    el = next((c for c in ui if isinstance(c.tag, str) and _ln(c) in UI_TYPES), None) if ui is not None else None
    return (UI_TYPES[_ln(el)] if el is not None else "text"), el


def _bind_path(e, scope, data_index, idx=0):
    b = _child(e, "bind"); name = e.get("name")
    match = b.get("match", "once") if b is not None else "once"
    if match == "none": return None, False
    if match == "dataRef" and b.get("ref"):
        ref = re.sub(r"\[(\*|0)\]", "", b.get("ref").strip())
        if ref.startswith("$record."): return ref[len("$record."):] if not scope else f"{scope[0]}.{ref[len('$record.'):]}", True
        if ref.startswith("$data."): return ref[len("$data."):], True
        if ref.startswith("$."): return ".".join(scope + [ref[2:]]), True
        if ref == "$": return ".".join(scope), True
        return ".".join(scope + [ref]), True
    if match == "global" and name:
        hit = next((p for p in data_index if _split(p)[-1] == _esc(name)), None)
        return hit or ".".join(scope + [_esc(name)]), True
    # bind match="once" (default): the n-th same-named sibling binds to the n-th same-named data node
    return (".".join(scope + [_esc(name) + (f"[{idx}]" if idx else "")]) if name else None), True


def _occur(e):
    o = _child(e, "occur")
    if o is None: return None
    def iv(k, d):
        try: return int(o.get(k, d))
        except ValueError: return int(d)
    mn = iv("min", "1"); mx = iv("max", "1"); ini = iv("initial", str(mn))
    return {"min": mn, "max": mx, "initial": ini}


def _page_geometry(tpl, top):
    """First pageArea/contentArea of the root pageSet → page size + content box (pt), plus its static draw text."""
    ps = _child(top, "pageSet")
    pa = next((c for c in ps.iter() if _ln(c) == "pageArea"), None) if ps is not None else None
    g = {"w": PAGE_W, "h": PAGE_H, "cx": MARGIN, "cy": MARGIN, "cw": PAGE_W - 2 * MARGIN, "ch": PAGE_H - 2 * MARGIN, "master_text": [], "from_template": False}
    if pa is None: return g
    med = _child(pa, "medium")
    if med is not None:
        a, b = meas(med.get("short")), meas(med.get("long"))
        if a and b:
            if med.get("orientation") == "landscape": a, b = b, a
            g["w"], g["h"] = a, b
    ca = _child(pa, "contentArea")
    if ca is not None:
        g.update(cx=meas(ca.get("x"), 0) or 0, cy=meas(ca.get("y"), 0) or 0,
                 cw=meas(ca.get("w")) or g["w"], ch=meas(ca.get("h")) or g["h"], from_template=True)
    for d in pa:
        if _ln(d) == "draw":
            t = _text_of(_child(d, "value"))
            if t: g["master_text"].append({"text": t, "x": meas(d.get("x"), 0) or 0, "y": meas(d.get("y"), 0) or 0, "h": meas(d.get("h"), 12) or 12})
    return g


MAX_INSTANCES = 50


def _template_fields(tpl, values, warn=None):
    """Walk the template once: returns (fields, statics, meta) with a flow layout in points.
    Coordinates are relative to the top-left of an endless content column; paging happens later.
    som = fully indexed SOM path (form1[0].#subform[2].Name[0]); for hybrid forms this equals the AcroForm field name."""
    warn = warn if warn is not None else set()
    fields, statics, scripts = [], [], [0]
    top = next((c for c in tpl if _ln(c) == "subform"), None)
    if top is None: raise EngineError("xfa_dynamic_unsupported", "XFA template has no root subform; nothing can be rendered",
                                      {"unsupported": ["template without a root <subform>"]})
    data_index = list(values)
    geo = _page_geometry(tpl, top)
    if _child(top, "pageSet") is not None and not geo["from_template"]: warn.add("pageSet_without_contentArea_default_letter")

    def instances(e, scope):
        """How many instances of a repeatable subform to emit: max(initial, min, data instances), capped by max."""
        oc = _occur(e)
        if oc is None or oc["max"] == 1: return 1, oc
        name = e.get("name"); n = max(oc["initial"], oc["min"], 1)
        if name:
            base = ".".join(scope + [_esc(name)]); idx = set()
            for p in data_index:
                if p == base or p.startswith(base + "."): idx.add(0)
                m = re.match(re.escape(base) + r"\[(\d+)\]", p)
                if m: idx.add(int(m.group(1)))
            if idx: n = max(n, max(idx) + 1)
        if oc["max"] >= 0: n = min(n, oc["max"])
        if n > MAX_INSTANCES: warn.add("repeat_instances_capped_at_50"); n = MAX_INSTANCES
        return max(n, 0), oc

    def place(e, x, y, scope, tpath, depth, seg, ctx, inst=0, shared=None):
        """Place element e with its top-left at (x, y). Returns (w, h) used."""
        if depth > MAX_DEPTH: raise EngineError("XFA_TOO_LARGE", "XFA template nesting too deep")
        t = _ln(e)
        mi = re.search(r"\[(\d+)\]$", seg); sidx = int(mi.group(1)) if mi else 0
        n_sc = sum(1 for c in e if _ln(c) in ("event", "calculate", "validate") and _child(c, "script") is not None)
        n_sc += sum(1 for c in e if _ln(c) == "variables" for s in c if _ln(s) == "script")
        if n_sc: scripts[0] += n_sc; warn.add("scripts_ignored")
        if _ln(e) != "subform" and _child(e, "occur") is not None and (_occur(e) or {}).get("max", 1) != 1:
            warn.add("repeat_on_non_subform_rendered_once")
        if e.get("presence") in ("hidden", "inactive"): return 0, 0
        if t in ("subform", "area", "subformSet"):
            name = e.get("name"); b = _child(e, "bind")
            dname = _esc(name) + (f"[{sidx}]" if sidx else "") if name else None
            nscope = scope + [dname] if (t == "subform" and name and not (b is not None and b.get("match") == "none")) else scope
            if b is not None and b.get("match") == "dataRef" and b.get("ref"):
                p, _ = _bind_path(e, scope, data_index); nscope = _split(p) if p else scope
            ntp = tpath + [seg] if t != "subformSet" else tpath
            nctx = ctx
            if t == "subform":
                cap, _, _ = _caption(e)
                tip = _text_of(_child(_child(e, "assist"), "toolTip"))
                oc = _occur(e)
                nctx = {"section": ".".join(ntp), "section_name": name, "section_caption": cap or tip or ctx.get("section_caption") if not name else (cap or tip),
                        "occur": oc if oc and oc["max"] != 1 else ctx.get("occur"), "instance": inst if oc and oc["max"] != 1 else ctx.get("instance")}
            layout = e.get("layout", "position")
            if layout not in ("position", "tb", "lr-tb", "rl-tb", "table", "row"): layout = "tb"
            if layout in ("rl-tb",): warn.add("layout_rl-tb_rendered_as_lr-tb")
            if layout == "table": warn.add("layout_table_rendered_as_tb")
            w, h = meas(e.get("w")), meas(e.get("h"))
            avail = w or geo["cw"]
            used_h, used_w = 0.0, 0.0
            if _child(e, "pageSet") is not None and depth > 0: warn.add("nested_pageSet_ignored")
            cursor, cx, row_h = y, x, 0.0
            # Unnamed containers (and areas / subformSets) are transparent in XFA SOM: their children are indexed
            # together with the nearest named ancestor's children (matches Designer's AcroForm names, e.g. USCIS forms).
            cnt = shared if ((t in ("area", "subformSet") or not name) and shared is not None) else {}
            for c in [c for c in e if _ln(c) in CONTAINERS]:
                ct = _ln(c); key = (c.get("name") or "#" + ct).replace(".", "\\.")
                n = instances(c, nscope)[0] if ct == "subform" else 1
                for i in range(n):
                    ck = "#" + ct; cidx = cnt.get(ck, 0); cnt[ck] = cidx + 1  # unnamed objects are indexed by class among all siblings
                    if c.get("name"): idx = cnt.get(key, 0); cnt[key] = idx + 1
                    else: idx = cidx
                    cseg = f"{key}[{idx}]"
                    ii = i if ct == "subform" else 0
                    if layout == "position":
                        px, py = x + (meas(c.get("x"), 0) or 0), y + (meas(c.get("y"), 0) or 0)
                        if i: py += used_h - (py - y)  # extra instances stack below
                        cw, ch = place(c, px, py, nscope, ntp, depth + 1, cseg, nctx, ii, cnt)
                        used_h = max(used_h, py - y + ch); used_w = max(used_w, px - x + cw)
                    elif layout in ("lr-tb", "rl-tb", "row"):
                        cwid = meas(c.get("w")) or meas(c.get("minW")) or 160
                        if cx > x and cx - x + cwid > avail: cursor += row_h + 2; cx = x; row_h = 0
                        cw, ch = place(c, cx, cursor, nscope, ntp, depth + 1, cseg, nctx, ii, cnt)
                        cx += max(cw, 1) + 4; row_h = max(row_h, ch); used_h = cursor - y + row_h; used_w = max(used_w, cx - x)
                    else:
                        cw, ch = place(c, x, cursor, nscope, ntp, depth + 1, cseg, nctx, ii, cnt)
                        cursor += ch + 4; used_h = cursor - y; used_w = max(used_w, cw)
            return (w or used_w), (h if h is not None and layout == "position" else max(used_h, h or 0))
        base = {"section": ctx.get("section"), "section_name": ctx.get("section_name"), "section_caption": ctx.get("section_caption"),
                "occur": ctx.get("occur"), "instance": ctx.get("instance")}
        if t == "exclGroup":
            name = e.get("name"); p, bound = _bind_path(e, scope, data_index, sidx)
            opts, rects, caps, kid_soms = [], [], [], []
            layout = e.get("layout", "position"); cursor = y; used_h = used_w = 0.0; kc = {}
            for c in [c for c in e if _ln(c) == "field"]:
                disp, save = _items(c); on = (save or disp or [c.get("name") or str(len(opts) + 1)])[0]
                cw, ch = meas(c.get("w"), 120), meas(c.get("h"), 18)
                cx, cy = (x + (meas(c.get("x"), 0) or 0), y + (meas(c.get("y"), 0) or 0)) if layout == "position" else (x, cursor)
                cap, _, _ = _caption(c)
                k = c.get("name") or "#field"; kid_soms.append(f"{k}[{kc.get(k, 0)}]"); kc[k] = kc.get(k, 0) + 1
                opts.append(on); rects.append([cx, cy, min(cw, ch), min(cw, ch)]); caps.append(cap or on)
                if layout != "position": cursor += ch + 2; used_h = cursor - y
                else: used_h = max(used_h, cy - y + ch)
                used_w = max(used_w, cw)
                if cap: statics.append({"text": cap, "x": cx + min(cw, ch) + 4, "y": cy, "h": max(ch, 10), "w": max(cw - min(cw, ch) - 4, 40)})
            fields.append({**base, "name": p if bound else None, "som": ".".join(tpath + [seg]), "type": "radio",
                           "caption": _caption(e)[0], "options": opts, "option_captions": caps, "rects": rects,
                           "value": values.get(p) if bound else None, "required": False, "read_only": e.get("access") in ("readOnly", "protected"),
                           "multiline": False, "max_chars": None, "x": x, "y": y, "w": used_w, "h": used_h})
            return used_w, used_h
        if t == "draw":
            v = _child(e, "value")
            txt = _text_of(v); w, h = meas(e.get("w"), 0), meas(e.get("h"), 14 if txt else 0)
            if txt and v is not None and _child(v, "image") is None:
                statics.append({"text": txt, "x": x, "y": y, "h": h, "w": w})
            if v is not None and any(_ln(c) in ("image", "line", "rectangle", "arc") for c in v): warn.add("draw_graphics_not_rendered")
            return w or (len(txt or "") * 5.5), h
        if t == "field":
            kind, uiel = _ui(e); name = e.get("name"); p, bound = _bind_path(e, scope, data_index, sidx)
            cap, place_, reserve = _caption(e)
            multiline = kind == "text" and uiel is not None and uiel.get("multiLine") == "1"
            w = meas(e.get("w")) or meas(e.get("minW")) or (14 if kind == "checkbox" else 160)
            h = meas(e.get("h")) or meas(e.get("minH")) or (54 if multiline else (14 if kind == "checkbox" else 20))
            disp, save = _items(e)
            maxc = None; v = _child(e, "value")
            te = _child(v, "text") if v is not None else None
            if te is not None and te.get("maxChars"): maxc = int(te.get("maxChars")) if te.get("maxChars").isdigit() else None
            default = _text_of(v)
            val = values.get(p) if bound and p in values else default
            vt = _child(e, "validate")
            on_value = (disp or ["1"])[0] if kind == "checkbox" else None
            if kind in ("button", "image", "barcode"): warn.add(f"{kind}_fields_not_converted")
            fields.append({**base, "name": p if bound else None, "som": ".".join(tpath + [seg]), "type": kind, "caption": cap, "tooltip": _text_of(_child(_child(e, "assist"), "toolTip")),
                           "caption_placement": place_, "caption_reserve": reserve,
                           "options": (save or disp) if kind == "choice" else None, "option_captions": disp if kind == "choice" else None,
                           "multi_select": kind == "choice" and uiel is not None and uiel.get("open") == "multiSelect",
                           "on_value": on_value, "value": val,
                           "required": vt is not None and vt.get("nullTest") == "error",
                           "read_only": e.get("access") in ("readOnly", "protected", "nonInteractive"),
                           "multiline": multiline, "max_chars": maxc, "x": x, "y": y, "w": w, "h": h})
            return w, h
        return 0, 0

    tname = top.get("name") or "#subform"
    place(top, 0, 0, [], [], 0, f"{tname}[0]", {})
    return fields, statics, {"scripts_ignored": scripts[0], "warnings": sorted(warn), "geometry": geo}


def template_schema(data_bytes: bytes) -> dict:
    ctx = _Ctx(data_bytes)
    if "template" not in ctx.pkts: raise EngineError("XFA_MALFORMED", "XFA has no template packet")
    fields, _, meta = _template_fields(ctx.pkts["template"], ctx.values)
    pub = []
    for f in fields:
        g = {k: f.get(k) for k in ("name", "som", "type", "caption", "options", "option_captions", "multi_select", "on_value",
                                   "value", "required", "read_only", "multiline", "max_chars", "section", "section_name",
                                   "section_caption", "occur", "instance", "tooltip")}
        af = ctx.acro.get(f["som"])
        g["acroform_field"] = f["som"] if af else None
        if af and af["read_only"]: g["read_only"] = True
        if af and af.get("max_length") and not g["max_chars"]: g["max_chars"] = af["max_length"]  # comb/MaxLen fields
        g["layout"] = {"x": round(f["x"], 2), "y": round(f["y"], 2), "w": round(f["w"], 2), "h": round(f["h"], 2), "units": "pt", "origin": "top-left of root subform"}
        pub.append(g)
    return {"xfa": ctx.info, "fields": pub, "warnings": meta["warnings"], "scripts_ignored": meta["scripts_ignored"]}


# ---------- conversion ----------
def _strip(pdf):
    acro = pdf.Root.get("/AcroForm")
    if acro is not None and "/XFA" in acro: del acro["/XFA"]
    if "/NeedsRendering" in pdf.Root: del pdf.Root["/NeedsRendering"]


def strip_xfa(data_bytes: bytes) -> bytes:
    pdf = open_pdf(data_bytes); _strip(pdf); strip_usage_rights(pdf); return _save(pdf)


def _safe_name(s, used, n):
    b = re.sub(r"[^A-Za-z0-9_\-]", "_", s or f"field{n}")[:90] or f"field{n}"
    out, i = b, 2
    while out in used: out = f"{b}_{i}"; i += 1
    used.add(out); return out


PAGE_W, PAGE_H, MARGIN = 612.0, 792.0, 36.0


def _render_dynamic(pdf, pkts) -> tuple[bytes, dict]:
    from reportlab.pdfgen import canvas
    from .forms import create_fields, fill_fields
    if "template" not in pkts: raise EngineError("xfa_dynamic_unsupported", "Dynamic XFA has no template packet, so there is no layout to render",
                                                 {"unsupported": ["missing template packet"]})
    _, data = _data_root(pkts); values = dict(_flatten_data(data)) if data is not None else {}
    fields, statics, meta = _template_fields(pkts["template"], values)
    convertible = [f for f in fields if f["type"] not in ("button", "image", "barcode")]
    if not convertible: raise EngineError("xfa_dynamic_unsupported", "XFA template contains no fillable fields that can be rendered",
                                          {"unsupported": sorted({f["type"] for f in fields}) or ["no fields"], "warnings": meta["warnings"]})
    geo = meta["geometry"]; PW, PH, CX, CY = geo["w"], geo["h"], geo["cx"], geo["cy"]
    col_h, col_w = geo["ch"], geo["cw"]
    scale = min(1.0, col_w / max([f["x"] + f["w"] for f in fields] + [1]))
    if scale < 0.999: meta["warnings"].append("layout_scaled_to_fit_content_width")

    def pg(y, h):
        y, h = y * scale, h * scale; p = int(y // col_h); ly = y - p * col_h
        if ly + h > col_h and h < col_h: p += 1; ly = 0
        return p, ly

    def rect(x, y, w, h):
        p, ly = pg(y, h); x0 = CX + x * scale; top = PH - CY - ly
        return p, [round(x0, 2), round(top - h * scale, 2), round(x0 + w * scale, 2), round(top, 2)]

    items, used, mapping = [], set(), {}
    for i, f in enumerate(convertible):
        cap, plc = f.get("caption"), f.get("caption_placement", "left")
        x, y, w, h = f["x"], f["y"], f["w"], f["h"]
        if f["type"] == "radio":
            rr = []
            for r in f["rects"]: rr.append(rect(*r))
            page = rr[0][0]; f["_rects"] = [r for _, r in rr]
        else:
            if cap and f["type"] != "checkbox":
                if plc == "top":
                    res = f.get("caption_reserve") or 12; statics.append({"text": cap, "x": x, "y": y, "h": res, "w": w}); y += res; h = max(h - res, 12)
                elif plc in ("left", None):
                    res = f.get("caption_reserve") or min(w * 0.4, len(cap) * 5.5 + 6)
                    statics.append({"text": cap, "x": x, "y": y, "h": h, "w": res - 2}); x += res; w = max(w - res, 20)
                else:
                    statics.append({"text": cap, "x": x, "y": y + h, "h": 12})
            elif cap:
                statics.append({"text": cap, "x": x + min(w, h) + 4, "y": y, "h": max(h, 10), "w": max(w - min(w, h) - 4, 40)}); w = h = min(w, h)
            page, f["_rect"] = rect(x, y, w, h)
        f["_page"] = page + 1; f["_acro"] = _safe_name(f.get("name") or f["som"], used, i); items.append(f)
    npages = max([f["_page"] for f in items] + [pg(s["y"], s["h"])[0] + 1 for s in statics] + [1])
    from reportlab.pdfbase.pdfmetrics import stringWidth
    buf = io.BytesIO(); cv = canvas.Canvas(buf, pagesize=(PW, PH)); cv.setTitle("Converted from XFA")

    def text(x0, top, txt, width, height):
        """Word-wrapped static text inside its box (draw width), at most as many lines as fit (min 1)."""
        fs = 8 if width else 9; lines, cur = [], ""
        for para in txt.splitlines() or [""]:
            for word in para.split():
                t = (cur + " " + word).strip()
                if width and stringWidth(t, "Helvetica", fs) > width and cur: lines.append(cur); cur = word
                else: cur = t
            lines.append(cur); cur = ""
        maxl = max(1, int(height // (fs + 1))) if height else len(lines)
        cv.setFont("Helvetica", fs)
        for i, ln in enumerate(lines[:maxl]): cv.drawString(x0, top - (i + 1) * (fs + 1), ln[:300])

    for p in range(npages):
        for m in geo["master_text"]:  # pageArea (master page) static text, repeated on every page
            text(m["x"], PH - m["y"], m["text"], 0, m["h"])
        for s in statics:
            sp, ly = pg(s["y"], s["h"])
            if sp == p: text(CX + s["x"] * scale, PH - CY - ly, s["text"], (s.get("w") or 0) * scale, max(s["h"] * scale, 10))
        cv.setStrokeColorRGB(0.55, 0.55, 0.6); cv.setLineWidth(0.5)  # light field boxes so the form is legible when printed
        for f in items:
            if f["_page"] - 1 != p: continue
            for r in (f.get("_rects") or [f.get("_rect")]):
                if r: cv.rect(r[0] - 1, r[1] - 1, r[2] - r[0] + 2, r[3] - r[1] + 2, stroke=1, fill=0)  # outside the widget (its AP paints a white background)
        cv.showPage()
    cv.save(); base = buf.getvalue()
    specs, vals = [], {}
    for f in items:
        t = f["type"]; spec = {"name": f["_acro"], "page": f["_page"], "required": f["required"], "read_only": False}
        if t in ("text", "numeric", "date", "password"):
            spec.update(type="multiline" if f["multiline"] else "text", rect=f["_rect"])
            if f["max_chars"]: spec["max_length"] = f["max_chars"]
            if f["value"] not in (None, ""): vals[f["_acro"]] = str(f["value"])[: f["max_chars"] or None]
        elif t == "checkbox":
            spec.update(type="checkbox", rect=f["_rect"])
            if f["value"] not in (None, ""): vals[f["_acro"]] = str(f["value"]) == str(f["on_value"]) or str(f["value"]).lower() in ("1", "true", "on", "yes")
        elif t == "choice":
            opts = [o for o in (f["options"] or []) if o != ""]
            if not opts: spec.update(type="text", rect=f["_rect"]); meta["warnings"].append("choice_without_items_as_text")
            else: spec.update(type="listbox" if f["multi_select"] else "dropdown", rect=f["_rect"], options=opts)
            if f["value"] not in (None, "") and (not opts or f["value"] in opts): vals[f["_acro"]] = f["value"]
        elif t == "radio":
            if len(f["options"]) < 2: spec.update(type="checkbox", rect=f["_rects"][0])
            else:
                onames = {}; u2 = set()
                for o in f["options"]: onames[o] = _safe_name(o, u2, len(u2))
                f["_onames"] = onames; spec.update(type="radio", options=list(onames.values()), rects=f["_rects"])
                if f["value"] in onames: vals[f["_acro"]] = onames[f["value"]]
        elif t == "signature":
            spec.update(type="signature", rect=f["_rect"])
        specs.append(spec); mapping[f["_acro"]] = {"xfa_name": f.get("name"), "som": f["som"], "type": t}
    out = create_fields(base, specs)
    # dropdown/listbox: show XFA display labels, keep save values as export values (/Opt [[export display] ...])
    lab = {f["_acro"]: f for f in items if f["type"] == "choice" and f.get("option_captions") and f.get("options") and f["option_captions"] != f["options"]}
    if lab:
        from .forms import _walk
        pdf2 = open_pdf(out)
        for n, fo in _walk(pdf2.Root.AcroForm.Fields):
            f = lab.get(n)
            if f is not None and "/Opt" in fo:
                pairs = dict(zip(f["options"], f["option_captions"]))
                fo.Opt = Array([Array([String(str(o)), String(str(pairs.get(str(o), o)))]) for o in fo.Opt])
        out = _save(pdf2)
    if vals: out, _ = fill_fields(out, vals)
    return out, {"mode": "rendered_from_template", "pages": npages, "fields": len(specs), "field_map": mapping,
                 "warnings": sorted(set(meta["warnings"])), "scripts_ignored": meta["scripts_ignored"]}


def convert_to_acroform(data_bytes: bytes) -> tuple[bytes, dict]:
    pdf = open_pdf(data_bytes); info = detect_pdf(pdf)
    if not info["present"]: raise EngineError("XFA_NOT_PRESENT", "Document has no XFA form")
    if info["kind"] == "hybrid":
        _strip(pdf); ur = strip_usage_rights(pdf)
        return _save(pdf), {"mode": "stripped_xfa", "kept_acroform_widgets": info["acroform_widgets"],
                            "scripts_ignored": info["script_count"], "warnings": [], "usage_rights_removed": ur}
    _, pkts = _packets_xml(pdf)
    out, rep = _render_dynamic(pdf, pkts); rep["scripts_ignored"] = max(rep["scripts_ignored"], info["script_count"])
    rep["warnings"].append("original_static_page_content_replaced_by_generated_layout")
    return out, rep


def capabilities(data_bytes: bytes) -> dict:
    """What the XFA endpoints can do for this document (cheap: detection only, no template walk)."""
    try: info = detect(data_bytes)
    except EngineError as e:
        return {"present": True, "kind": "unknown", "read": False, "schema": False, "fill": False, "xml_import_export": False,
                "convert": False, "flatten": False, "has_scripts": False, "error": e.code}
    ok = info["present"] and info["xml_safe"] is not False
    return {"present": info["present"], "kind": info["kind"], "read": ok, "schema": ok, "fill": ok, "xml_import_export": ok,
            "convert": ok, "flatten": ok or info["kind"] == "none", "has_scripts": info["has_scripts"], "error": None if ok or not info["present"] else "XFA_UNSAFE_XML"}
