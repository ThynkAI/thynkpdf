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

MAX_PACKET = 5 * 1024 * 1024
MAX_TOTAL = 20 * 1024 * 1024
MAX_NODES = 20000
MAX_DEPTH = 64
XFA_DATA_NS = "http://www.xfa.org/schema/xfa-data/1.0/"
XDP_NS = "http://ns.adobe.com/xdp/"
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
        if name in ("preamble", "postamble") or not b.strip(): continue
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
    if form == "array": names = [n for n, _ in raws]
    else:
        try: names = [_ln(c) for c in safe_parse(raws[0][1]) if _ln(c)]
        except EngineError: names = list(dict.fromkeys(m.decode() for m in _PKT_RE.findall(raws[0][1])))
    xml_safe = True
    for n, b in raws:
        if n in ("preamble", "postamble") or not b.strip(): continue
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
        if not kids:
            out.append((path, e.text or "")); return
        seen = {}
        for c in kids:
            n = _ln(c); i = seen.get(n, 0); seen[n] = i + 1
            rec(c, f"{path}.{n}" + (f"[{i}]" if i else ""), depth + 1)
    seen = {}
    for c in data:
        if not isinstance(c.tag, str): continue
        n = _ln(c); i = seen.get(n, 0); seen[n] = i + 1
        rec(c, n + (f"[{i}]" if i else ""), 1)
    return out


_SEG = re.compile(r"^([^\[\]]+)(?:\[(\d+)\])?$")


def _find_node(data, path, create=False):
    cur = data
    for seg in path.split("."):
        m = _SEG.match(seg)
        if not m: raise EngineError("VALIDATION_ERROR", "Invalid XFA data path", {"path": path})
        n, i = m.group(1), int(m.group(2) or 0)
        kids = [c for c in cur if isinstance(c.tag, str) and _ln(c) == n]
        if i < len(kids): cur = kids[i]; continue
        if not create or i != len(kids): return None
        if not re.match(r"^[A-Za-z_][\w.-]*$", n): raise EngineError("VALIDATION_ERROR", "Invalid XFA element name", {"path": path})
        cur = etree.SubElement(cur, n)
    return cur


def norm_acro(name: str) -> str:
    return re.sub(r"\[0\]", "", name)


def read_data(data_bytes: bytes) -> dict:
    pdf = open_pdf(data_bytes); info = detect_pdf(pdf)
    if not info["present"]: raise EngineError("XFA_NOT_PRESENT", "Document has no XFA form")
    _, pkts = _packets_xml(pdf); _, data = _data_root(pkts)
    acro = {}
    from .forms import list_fields
    for f in list_fields(data_bytes): acro[norm_acro(f["name"])] = f["name"]
    rows = [] if data is None else _flatten_data(data)
    return {"xfa": info, "fields": [{"name": p, "value": v, "acroform_field": acro.get(re.sub(r"\[0\]", "", p))} for p, v in rows]}


def _xml_value(v):
    if v is True: return "1"
    if v is False: return "0"
    if v is None: return ""
    if isinstance(v, list): return " ".join(str(x) for x in v)
    return str(v)


def fill(data_bytes: bytes, values: dict) -> tuple[bytes, dict]:
    """Hybrid: AcroForm + datasets both written. Dynamic: datasets only (missing nodes are created)."""
    pdf = open_pdf(data_bytes); info = detect_pdf(pdf)
    if not info["present"]: raise EngineError("XFA_NOT_PRESENT", "Document has no XFA form")
    if not values: raise EngineError("VALIDATION_ERROR", "values is empty")
    _, pkts = _packets_xml(pdf)
    from .forms import list_fields, fill_fields
    acro_fields = {norm_acro(f["name"]): f for f in list_fields(data_bytes)} if info["kind"] == "hybrid" else {}
    data_paths = {p for p, _ in _flatten_data(_data_root(pkts)[1])} if _data_root(pkts)[1] is not None else set()
    schema_paths = set()
    if "template" in pkts:
        try: schema_paths = {f["name"] for f in _template_fields(pkts["template"], {})[0] if f.get("name")}
        except EngineError: pass
    acro_vals, plan, unknown = {}, {}, []
    for k, v in values.items():
        nk = norm_acro(k)
        af = acro_fields.get(nk)
        if af: acro_vals[af["name"]] = v
        if af or nk in data_paths or nk in schema_paths: plan[nk] = v
        else: unknown.append(k)
    if unknown: raise EngineError("FORM_FIELD_NOT_FOUND", "Unknown XFA fields", {"fields": unknown})
    rep = {"filled": list(values), "kind": info["kind"], "acroform_updated": sorted(acro_vals), "datasets_updated": sorted(plan)}
    if acro_vals:
        data_bytes, r = fill_fields(data_bytes, acro_vals); rep["missing_required"] = r.get("missing_required", [])
        pdf = open_pdf(data_bytes); _, pkts = _packets_xml(pdf)
    ds, data = _data_root(pkts, create=True)
    for path, v in plan.items():
        node = _find_node(data, path, create=True)
        for c in list(node): node.remove(c)
        node.text = _xml_value(v)
    _set_packet(pdf, "datasets", ds)
    return _save(pdf), rep


def sync_datasets_from_acro(data_bytes: bytes, names) -> bytes:
    """After an AcroForm fill on a hybrid doc, mirror the values into datasets so viewers agree."""
    pdf = open_pdf(data_bytes); info = detect_pdf(pdf)
    if info["kind"] != "hybrid": return data_bytes
    from .forms import list_fields
    vals = {f["name"]: f["value"] for f in list_fields(data_bytes)}
    _, pkts = _packets_xml(pdf); ds, data = _data_root(pkts, create=True)
    for n in names:
        if n in vals:
            node = _find_node(data, norm_acro(n), create=True); node.text = _xml_value(vals[n])
    _set_packet(pdf, "datasets", ds); return _save(pdf)


def export_xml(data_bytes: bytes) -> bytes:
    pdf = open_pdf(data_bytes)
    if _xfa_obj(pdf) is None: raise EngineError("XFA_NOT_PRESENT", "Document has no XFA form")
    _, pkts = _packets_xml(pdf); ds, _ = _data_root(pkts, create=True)
    return etree.tostring(ds, encoding="utf-8", xml_declaration=True)


def import_xml(data_bytes: bytes, xml: bytes) -> tuple[bytes, dict]:
    """Accepts <xfa:datasets>, <xfa:data>, or a bare record element. Hybrid docs also get AcroForm values."""
    pdf = open_pdf(data_bytes); info = detect_pdf(pdf)
    if not info["present"]: raise EngineError("XFA_NOT_PRESENT", "Document has no XFA form")
    root = safe_parse(xml)
    if _ln(root) == "datasets": ds = root
    else:
        ds = etree.Element(f"{{{XFA_DATA_NS}}}datasets", nsmap={"xfa": XFA_DATA_NS})
        if _ln(root) == "data": ds.append(root)
        else: etree.SubElement(ds, f"{{{XFA_DATA_NS}}}data").append(root)
    data = next((c for c in ds if _ln(c) == "data"), None)
    if data is None: raise EngineError("VALIDATION_ERROR", "datasets XML has no xfa:data element")
    rows = _flatten_data(data)
    _set_packet(pdf, "datasets", ds); out = _save(pdf)
    rep = {"imported": len(rows), "kind": info["kind"], "acroform_updated": []}
    if info["kind"] == "hybrid":
        from .forms import list_fields, fill_fields
        by = {norm_acro(f["name"]): f for f in list_fields(out)}
        vals = {}
        for p, v in rows:
            f = by.get(p)
            if not f or f["read_only"] or f["type"] in ("signature", "pushbutton", "unknown"): continue
            if f["type"] == "checkbox": vals[f["name"]] = v not in ("", "0", "false", "Off")
            elif f["type"] in ("radio", "dropdown", "listbox") and v not in (f["options"] or []): continue
            else: vals[f["name"]] = v
        if vals:
            out, _ = fill_fields(out, vals); rep["acroform_updated"] = sorted(vals)
    return out, rep


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


def _bind_path(e, scope, data_index):
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
        hit = next((p for p in data_index if p.split(".")[-1] == name), None)
        return hit or ".".join(scope + [name]), True
    return (".".join(scope + [name]) if name else None), True


def _template_fields(tpl, values, warn=None):
    """Walk the template once: returns (fields, statics, unsupported) with a top-down layout in points.
    Coordinates are relative to the top-left of an endless content column; paging happens later."""
    warn = warn if warn is not None else set()
    fields, statics, scripts = [], [], [0]
    top = next((c for c in tpl if _ln(c) == "subform"), None)
    if top is None: raise EngineError("xfa_dynamic_unsupported", "XFA template has no root subform; nothing can be rendered",
                                      {"unsupported": ["template without a root <subform>"]})
    data_index = list(values)

    def place(e, x, y, scope, tpath, depth):
        """Place element e with its top-left at (x, y). Returns (w, h) used."""
        if depth > MAX_DEPTH: raise EngineError("XFA_TOO_LARGE", "XFA template nesting too deep")
        t = _ln(e)
        n_sc = sum(1 for c in e if _ln(c) in ("event", "calculate", "validate") and _child(c, "script") is not None)
        n_sc += sum(1 for c in e if _ln(c) == "variables" for s in c if _ln(s) == "script")
        if n_sc: scripts[0] += n_sc; warn.add("scripts_ignored")
        occ = _child(e, "occur")
        if occ is not None and occ.get("max", "1") not in ("1",):
            warn.add("repeating_subforms_rendered_once_per_data_instance_not_supported")
        if t in ("subform", "area", "subformSet"):
            name = e.get("name"); b = _child(e, "bind")
            nscope = scope + [name] if (t == "subform" and name and not (b is not None and b.get("match") == "none")) else scope
            if b is not None and b.get("match") == "dataRef" and b.get("ref"):
                p, _ = _bind_path(e, scope, data_index); nscope = p.split(".") if p else scope
            ntp = tpath + [name] if name else tpath
            layout = e.get("layout", "position")
            if layout not in ("position", "tb", "lr-tb", "rl-tb", "table", "row"): layout = "tb"
            if layout in ("lr-tb", "rl-tb", "table", "row"): warn.add(f"layout_{layout}_rendered_as_tb")
            w, h = meas(e.get("w")), meas(e.get("h"))
            used_h, used_w = 0.0, 0.0
            kids = [c for c in e if _ln(c) in CONTAINERS]
            for c in [c for c in e if _ln(c) in ("pageSet",)]:
                warn.add("pageSet_master_pages_ignored")
            cursor = y
            for c in kids:
                if layout == "position":
                    cx, cy = x + (meas(c.get("x"), 0) or 0), y + (meas(c.get("y"), 0) or 0)
                    cw, ch = place(c, cx, cy, nscope, ntp, depth + 1)
                    used_h = max(used_h, cy - y + ch); used_w = max(used_w, cx - x + cw)
                else:
                    cw, ch = place(c, x, cursor, nscope, ntp, depth + 1)
                    cursor += ch + 4; used_h = cursor - y; used_w = max(used_w, cw)
            return (w or used_w), (h if h is not None and layout == "position" else max(used_h, h or 0))
        if t == "exclGroup":
            name = e.get("name"); p, bound = _bind_path(e, scope, data_index)
            opts, rects, caps = [], [], []
            layout = e.get("layout", "position"); cursor = y; used_h = used_w = 0.0
            for c in [c for c in e if _ln(c) == "field"]:
                disp, save = _items(c); on = (save or disp or [c.get("name") or str(len(opts) + 1)])[0]
                cw, ch = meas(c.get("w"), 120), meas(c.get("h"), 18)
                cx, cy = (x + (meas(c.get("x"), 0) or 0), y + (meas(c.get("y"), 0) or 0)) if layout == "position" else (x, cursor)
                cap, _, _ = _caption(c)
                opts.append(on); rects.append([cx, cy, min(cw, ch), min(cw, ch)]); caps.append(cap or on)
                if layout != "position": cursor += ch + 2; used_h = cursor - y
                else: used_h = max(used_h, cy - y + ch)
                used_w = max(used_w, cw)
                if cap: statics.append({"text": cap, "x": cx + min(cw, ch) + 4, "y": cy, "h": ch})
            fields.append({"name": p if bound else None, "som": ".".join(tpath + [name or "exclGroup"]), "type": "radio",
                           "caption": None, "options": opts, "option_captions": caps, "rects": rects,
                           "value": values.get(p) if bound else None, "required": False, "read_only": e.get("access") in ("readOnly", "protected"),
                           "multiline": False, "max_chars": None, "x": x, "y": y, "w": used_w, "h": used_h})
            return used_w, used_h
        if t == "draw":
            txt = _text_of(_child(e, "value")); w, h = meas(e.get("w"), 0), meas(e.get("h"), 14 if txt else 0)
            if txt: statics.append({"text": txt, "x": x, "y": y, "h": h})
            v = _child(e, "value")
            if v is not None and any(_ln(c) in ("image", "line", "rectangle", "arc") for c in v): warn.add("draw_graphics_not_rendered")
            return w or (len(txt or "") * 5.5), h
        if t == "field":
            kind, uiel = _ui(e); name = e.get("name"); p, bound = _bind_path(e, scope, data_index)
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
            fields.append({"name": p if bound else None, "som": ".".join(tpath + [name or "field"]), "type": kind, "caption": cap,
                           "caption_placement": place_, "caption_reserve": reserve,
                           "options": (save or disp) if kind == "choice" else None, "option_captions": disp if kind == "choice" else None,
                           "multi_select": kind == "choice" and uiel is not None and uiel.get("open") == "multiSelect",
                           "on_value": on_value, "value": val,
                           "required": vt is not None and vt.get("nullTest") == "error",
                           "read_only": e.get("access") in ("readOnly", "protected", "nonInteractive"),
                           "multiline": multiline, "max_chars": maxc, "x": x, "y": y, "w": w, "h": h})
            return w, h
        return 0, 0

    place(top, 0, 0, [], [], 0)
    return fields, statics, {"scripts_ignored": scripts[0], "warnings": sorted(warn)}


def template_schema(data_bytes: bytes) -> dict:
    pdf = open_pdf(data_bytes); info = detect_pdf(pdf)
    if not info["present"]: raise EngineError("XFA_NOT_PRESENT", "Document has no XFA form")
    _, pkts = _packets_xml(pdf)
    if "template" not in pkts: raise EngineError("XFA_MALFORMED", "XFA has no template packet")
    _, data = _data_root(pkts); values = dict(_flatten_data(data)) if data is not None else {}
    fields, _, meta = _template_fields(pkts["template"], values)
    pub = []
    for f in fields:
        g = {k: f.get(k) for k in ("name", "som", "type", "caption", "options", "option_captions", "multi_select", "on_value",
                                   "value", "required", "read_only", "multiline", "max_chars")}
        g["layout"] = {"x": round(f["x"], 2), "y": round(f["y"], 2), "w": round(f["w"], 2), "h": round(f["h"], 2), "units": "pt", "origin": "top-left of root subform"}
        pub.append(g)
    return {"xfa": info, "fields": pub, "warnings": meta["warnings"], "scripts_ignored": meta["scripts_ignored"]}


# ---------- conversion ----------
def _strip(pdf):
    acro = pdf.Root.get("/AcroForm")
    if acro is not None and "/XFA" in acro: del acro["/XFA"]
    if "/NeedsRendering" in pdf.Root: del pdf.Root["/NeedsRendering"]


def strip_xfa(data_bytes: bytes) -> bytes:
    pdf = open_pdf(data_bytes); _strip(pdf); return _save(pdf)


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
    col_h, col_w = PAGE_H - 2 * MARGIN, PAGE_W - 2 * MARGIN
    scale = min(1.0, col_w / max([f["x"] + f["w"] for f in fields] + [1]))
    if scale < 1: meta["warnings"].append("layout_scaled_to_fit_letter_width")

    def pg(y, h):
        y, h = y * scale, h * scale; p = int(y // col_h); ly = y - p * col_h
        if ly + h > col_h and h < col_h: p += 1; ly = 0
        return p, ly

    def rect(x, y, w, h):
        p, ly = pg(y, h); x0 = MARGIN + x * scale; top = PAGE_H - MARGIN - ly
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
                    res = f.get("caption_reserve") or 12; statics.append({"text": cap, "x": x, "y": y, "h": res}); y += res; h = max(h - res, 12)
                elif plc in ("left", None):
                    res = f.get("caption_reserve") or min(w * 0.4, len(cap) * 5.5 + 6)
                    statics.append({"text": cap, "x": x, "y": y, "h": h}); x += res; w = max(w - res, 20)
                else:
                    statics.append({"text": cap, "x": x, "y": y + h, "h": 12})
            elif cap:
                statics.append({"text": cap, "x": x + min(w, h) + 4, "y": y, "h": h}); w = h = min(w, h)
            page, f["_rect"] = rect(x, y, w, h)
        f["_page"] = page + 1; f["_acro"] = _safe_name(f.get("name") or f["som"], used, i); items.append(f)
    npages = max([f["_page"] for f in items] + [pg(s["y"], s["h"])[0] + 1 for s in statics] + [1])
    buf = io.BytesIO(); cv = canvas.Canvas(buf, pagesize=(PAGE_W, PAGE_H)); cv.setTitle("Converted from XFA")
    for p in range(npages):
        cv.setFont("Helvetica", 9)
        for s in statics:
            sp, ly = pg(s["y"], s["h"])
            if sp == p: cv.drawString(MARGIN + s["x"] * scale, PAGE_H - MARGIN - ly - min(s["h"] * scale, 12) + 2, s["text"][:200])
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
    if vals: out, _ = fill_fields(out, vals)
    return out, {"mode": "rendered_from_template", "pages": npages, "fields": len(specs), "field_map": mapping,
                 "warnings": sorted(set(meta["warnings"])), "scripts_ignored": meta["scripts_ignored"]}


def convert_to_acroform(data_bytes: bytes) -> tuple[bytes, dict]:
    pdf = open_pdf(data_bytes); info = detect_pdf(pdf)
    if not info["present"]: raise EngineError("XFA_NOT_PRESENT", "Document has no XFA form")
    if info["kind"] == "hybrid":
        _strip(pdf); return _save(pdf), {"mode": "stripped_xfa", "kept_acroform_widgets": info["acroform_widgets"],
                                         "scripts_ignored": info["script_count"], "warnings": []}
    _, pkts = _packets_xml(pdf)
    out, rep = _render_dynamic(pdf, pkts); rep["scripts_ignored"] = max(rep["scripts_ignored"], info["script_count"])
    rep["warnings"].append("original_static_page_content_replaced_by_generated_layout")
    return out, rep
