"""True redaction: content under a redaction area is REMOVED from the file, not covered.

Implemented on pikepdf/qpdf (MPL-2.0) + Pillow (HPND) + reportlab font metrics (BSD) -- no AGPL dependency.

For every page with redaction marks the content stream (and any Form XObject it draws, recursively) is interpreted:
  * text: each glyph's box is computed from the font metrics, text state and CTM; glyphs inside a mark are deleted
    from the string operands and replaced by an equal TJ displacement, so surrounding text keeps its position;
  * vector graphics: painted paths touching a mark are dropped (a path whose box fully contains the mark, such as a
    page background or table frame, is kept and the fill box covers it);
  * images: pixels under a mark are overwritten in a NEW image object (the original object is kept only if it is still
    drawn somewhere else, un-redacted); images that cannot be decoded, stencil masks and inline images are removed whole;
  * annotations and form fields overlapping a mark are deleted; page thumbnails are dropped;
  * /ActualText, /Alt and /E replacement text of marked content containing a removed glyph is deleted.
The output is fully rewritten (no incremental update), so earlier revisions and unreachable objects are not carried over.

Document text is untrusted data: it is only measured and matched, never executed. Embedded scripts are never run.
"""
from __future__ import annotations
import math, re
import pikepdf
from pikepdf import Name, String, Array, Dictionary, Operator, Stream
from .engine import EngineError, open_pdf, _save, _check_pages

__all__ = ["redact", "search_text", "list_images", "sanitize", "PATTERNS"]

Rect = tuple[float, float, float, float]
IDENT = (1.0, 0.0, 0.0, 1.0, 0.0, 0.0)
MAX_DEPTH = 12
PAINT = {"S", "s", "f", "F", "f*", "B", "B*", "b", "b*"}
PATH_END = PAINT | {"n"}


# ---------------------------------------------------------------- geometry
def mul(m1, m2):
    a1, b1, c1, d1, e1, f1 = m1; a2, b2, c2, d2, e2, f2 = m2
    return (a1 * a2 + b1 * c2, a1 * b2 + b1 * d2, c1 * a2 + d1 * c2, c1 * b2 + d1 * d2,
            e1 * a2 + f1 * c2 + e2, e1 * b2 + f1 * d2 + f2)


def tp(m, x, y): return (m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5])


def inv(m):
    a, b, c, d, e, f = m; det = a * d - b * c
    if abs(det) < 1e-12: return None
    return (d / det, -b / det, -c / det, a / det, (c * f - d * e) / det, (b * e - a * f) / det)


def bbox(pts) -> Rect:
    xs = [p[0] for p in pts]; ys = [p[1] for p in pts]
    return (min(xs), min(ys), max(xs), max(ys))


def box_of(m, x0, y0, x1, y1) -> Rect: return bbox([tp(m, x0, y0), tp(m, x1, y0), tp(m, x0, y1), tp(m, x1, y1)])


def norm_rect(r) -> Rect:
    x0, y0, x1, y1 = (float(v) for v in r)
    return (min(x0, x1), min(y0, y1), max(x0, x1), max(y0, y1))


def overlaps(a: Rect, b: Rect, eps=1e-6) -> bool:
    return a[0] < b[2] - eps and b[0] < a[2] - eps and a[1] < b[3] - eps and b[1] < a[3] - eps


def touches(a: Rect, b: Rect) -> bool:  # closed-interval test (degenerate boxes, e.g. hairlines, count)
    return a[0] <= b[2] and b[0] <= a[2] and a[1] <= b[3] and b[1] <= a[3]


def contains(outer: Rect, inner: Rect) -> bool:
    return outer[0] <= inner[0] and outer[1] <= inner[1] and outer[2] >= inner[2] and outer[3] >= inner[3]


def inside(pt, r: Rect) -> bool: return r[0] <= pt[0] <= r[2] and r[1] <= pt[1] <= r[3]


def _num(x, d=0.0):
    try: return float(x)
    except Exception: return d


# ---------------------------------------------------------------- fonts
_RL = None


def _rl():
    global _RL
    if _RL is None:
        from reportlab.pdfbase import _fontdata, _glyphlist
        _RL = (_fontdata, _glyphlist._glyphname2unicode)
    return _RL


_STD_ALIAS = {"arial": "Helvetica", "arialmt": "Helvetica", "helvetica": "Helvetica", "timesnewroman": "Times-Roman",
              "timesnewromanpsmt": "Times-Roman", "times": "Times-Roman", "couriernew": "Courier", "couriernewpsmt": "Courier",
              "courier": "Courier", "symbol": "Symbol", "zapfdingbats": "ZapfDingbats"}


def _std_name(base: str) -> str | None:
    _fd, _ = _rl()
    b = base.split("+", 1)[-1]
    if b in _fd.widthsByFontGlyph: return b
    key = b.split(",")[0].split("-")[0].lower().replace(" ", "")
    fam = _STD_ALIAS.get(key)
    if not fam: return None
    if fam in ("Symbol", "ZapfDingbats"): return fam
    sty = b.lower()
    bold, ital = "bold" in sty, ("italic" in sty or "oblique" in sty)
    if fam == "Times-Roman":
        return {(0, 0): "Times-Roman", (1, 0): "Times-Bold", (0, 1): "Times-Italic", (1, 1): "Times-BoldItalic"}[(bold, ital)]
    return fam + {(0, 0): "", (1, 0): "-Bold", (0, 1): "-Oblique", (1, 1): "-BoldOblique"}[(bold, ital)]


def _glyph_uni(name: str) -> str:
    _, g2u = _rl()
    if name in g2u: return chr(g2u[name])
    m = re.fullmatch(r"uni([0-9A-Fa-f]{4,6})", name) or re.fullmatch(r"u([0-9A-Fa-f]{4,6})", name)
    if m: return chr(int(m.group(1), 16))
    base = name.split(".")[0]
    return chr(g2u[base]) if base in g2u else ""


def _hexbytes(s: str) -> bytes:
    s = re.sub(r"\s", "", s)
    if len(s) % 2: s += "0"
    return bytes.fromhex(s)


def _parse_cmap(data: bytes):
    """Returns (codespace [(len, lo, hi)], {code_bytes: unicode str}, [(lo, hi, start, len)] bfranges)."""
    t = data.decode("latin-1", "replace")
    spaces = []
    for blk in re.findall(r"begincodespacerange(.*?)endcodespacerange", t, re.S):
        for lo, hi in re.findall(r"<([0-9A-Fa-f\s]+)>\s*<([0-9A-Fa-f\s]+)>", blk):
            lb, hb = _hexbytes(lo), _hexbytes(hi)
            spaces.append((len(lb), int.from_bytes(lb, "big"), int.from_bytes(hb, "big")))
    single, ranges = {}, []

    def u16(b: bytes) -> str:
        try: return b.decode("utf-16-be")
        except Exception: return ""
    for blk in re.findall(r"beginbfchar(.*?)endbfchar", t, re.S):
        for src, dst in re.findall(r"<([0-9A-Fa-f\s]+)>\s*<([0-9A-Fa-f\s]*)>", blk):
            single[_hexbytes(src)] = u16(_hexbytes(dst))
    for blk in re.findall(r"beginbfrange(.*?)endbfrange", t, re.S):
        for lo, hi, rest in re.findall(r"<([0-9A-Fa-f\s]+)>\s*<([0-9A-Fa-f\s]+)>\s*(\[[^\]]*\]|<[0-9A-Fa-f\s]*>)", blk):
            lb, hb = _hexbytes(lo), _hexbytes(hi); n = len(lb); a, z = int.from_bytes(lb, "big"), int.from_bytes(hb, "big")
            if z - a > 65535: continue
            if rest.startswith("["):
                for i, d in enumerate(re.findall(r"<([0-9A-Fa-f\s]*)>", rest)):
                    if a + i > z: break
                    single[(a + i).to_bytes(n, "big")] = u16(_hexbytes(d))
            else:
                db = _hexbytes(rest[1:-1]); ranges.append((a, z, db, n))
    return spaces, single, ranges


class Font:
    """Metrics + decoding for one font resource. Widths in text-space units per 1 unit of font size."""

    def __init__(self, fd):
        self.fd = fd
        sub = str(fd.get("/Subtype", "")) if fd is not None else ""
        self.type0 = sub == "/Type0"; self.type3 = sub == "/Type3"
        self.asc, self.desc = 0.8, -0.2
        self.code_lens = None  # codespace for multi-byte fonts
        self._tu_single, self._tu_ranges = {}, []
        self._enc_names: dict[int, str] = {}
        self._std = None
        self.fm = 0.001
        self.widths, self.first, self.mw, self.cw, self.dw, self.identity, self.ucs2 = None, 0, 0.0, {}, 1.0, False, False
        if fd is None: return
        tu = fd.get("/ToUnicode")
        if isinstance(tu, Stream):
            try:
                sp, self._tu_single, self._tu_ranges = _parse_cmap(tu.read_bytes())
                if self.type0 and sp: self.code_lens = sp
            except Exception: pass
        desc_font = fd
        if self.type0:
            df = fd.get("/DescendantFonts")
            desc_font = df[0] if isinstance(df, Array) and len(df) else Dictionary()
            enc = fd.get("/Encoding")
            if isinstance(enc, Stream):
                try:
                    sp, _, _ = _parse_cmap(enc.read_bytes())
                    if sp: self.code_lens = sp
                except Exception: pass
            elif isinstance(enc, Name) and str(enc) in ("/Identity-H", "/Identity-V"):
                self.code_lens = [(2, 0, 0xFFFF)]
            self.identity = isinstance(enc, Name) and str(enc).startswith("/Identity")
            self.ucs2 = isinstance(enc, Name) and ("UCS2" in str(enc) or "UTF16" in str(enc))  # predefined Unicode CMaps
            if self.ucs2 and not self.code_lens: self.code_lens = [(2, 0, 0xFFFF)]
            self.dw = _num(desc_font.get("/DW", 1000), 1000) / 1000
            self.cw: dict[int, float] = {}
            w = desc_font.get("/W")
            if isinstance(w, Array):
                items, i = list(w), 0
                while i < len(items):
                    try:
                        c0 = int(items[i])
                        if i + 1 < len(items) and isinstance(items[i + 1], Array):
                            for k, v in enumerate(items[i + 1]): self.cw[c0 + k] = _num(v) / 1000
                            i += 2
                        else:
                            c1, v = int(items[i + 1]), _num(items[i + 2]) / 1000
                            for c in range(c0, min(c1, c0 + 65536) + 1): self.cw[c] = v
                            i += 3
                    except Exception: break
        else:
            self.first = int(_num(fd.get("/FirstChar", 0)))
            ws = fd.get("/Widths")
            self.widths = [_num(v) for v in ws] if isinstance(ws, Array) else None
            if self.type3:
                fm = fd.get("/FontMatrix")
                self.fm = _num(fm[0], 0.001) if isinstance(fm, Array) and len(fm) == 6 else 0.001
            base = str(fd.get("/BaseFont", ""))[1:]
            self._std = _std_name(base) if base else None
            enc = fd.get("/Encoding"); _fd, _ = _rl()
            names = list(_fd.encodings.get("StandardEncoding" if not self._std or self._std not in ("Symbol", "ZapfDingbats") else self._std + "Encoding", ()))
            if isinstance(enc, Name):
                names = list(_fd.encodings.get(str(enc)[1:], names))
            elif isinstance(enc, Dictionary):
                be = enc.get("/BaseEncoding")
                if isinstance(be, Name): names = list(_fd.encodings.get(str(be)[1:], names))
                diffs = enc.get("/Differences")
                if isinstance(diffs, Array):
                    names = names + [None] * (256 - len(names)); code = 0
                    for x in diffs:
                        if isinstance(x, Name): (names.__setitem__(code, str(x)[1:]) if 0 <= code < 256 else None); code += 1
                        else: code = int(_num(x))
            elif not names:
                names = list(_fd.encodings["WinAnsiEncoding"])
            self._enc_names = {i: n for i, n in enumerate(names) if n}
            self.mw = 0.0
        fdesc = desc_font.get("/FontDescriptor") if desc_font is not None else None
        if isinstance(fdesc, Dictionary):
            a, d = _num(fdesc.get("/Ascent", 0)), _num(fdesc.get("/Descent", 0))
            if 300 <= a <= 1500: self.asc = min(a / 1000, 1.1)
            if -600 <= d < 0: self.desc = max(d / 1000, -0.5)
            if not self.type0: self.mw = _num(fdesc.get("/MissingWidth", 0)) / 1000
        if self.type3:
            self.asc, self.desc = 0.8, -0.2

    def codes(self, b: bytes) -> list[bytes]:
        if not self.type0: return [b[i:i + 1] for i in range(len(b))]
        spaces = self.code_lens or [(2, 0, 0xFFFF)]
        out, i = [], 0
        while i < len(b):
            n = None
            for ln, lo, hi in sorted(spaces):
                if i + ln <= len(b) and lo <= int.from_bytes(b[i:i + ln], "big") <= hi: n = ln; break
            n = n or min(ln for ln, _, _ in spaces) or 1
            out.append(b[i:i + n]); i += n
        return out

    def width(self, code: bytes) -> float:
        c = int.from_bytes(code, "big")
        if self.type0:
            return self.cw.get(c, self.dw)
        if self.widths is not None and 0 <= c - self.first < len(self.widths):
            w = self.widths[c - self.first]
            return w * self.fm if self.type3 else w / 1000
        if self._std:
            _fd, _ = _rl(); n = self._enc_names.get(c)
            w = _fd.widthsByFontGlyph.get(self._std, {}).get(n) if n else None
            if w is not None: return w / 1000
        return self.mw or 0.5

    def unicode(self, code: bytes) -> str:
        if code in self._tu_single: return self._tu_single[code]
        c = int.from_bytes(code, "big")
        for a, z, db, n in self._tu_ranges:
            if a <= c <= z and len(code) == n:
                base = bytearray(db)
                v = int.from_bytes(base, "big") + (c - a)
                try: return v.to_bytes(len(base), "big").decode("utf-16-be")
                except Exception: return ""
        if not self.type0:
            n = self._enc_names.get(c)
            if n: return _glyph_uni(n)
            try: return code.decode("cp1252")
            except Exception: return ""
        if self.ucs2:
            try: return code.decode("utf-16-be")
            except Exception: return ""
        return ""


# ---------------------------------------------------------------- content interpretation
class _GS:
    __slots__ = ("ctm", "tc", "tw", "tz", "tl", "ts", "font", "fs", "tr", "lw")

    def __init__(self):
        self.ctm, self.tc, self.tw, self.tz, self.tl, self.ts, self.font, self.fs, self.tr, self.lw = IDENT, 0.0, 0.0, 100.0, 0.0, 0.0, None, 0.0, 0, 1.0

    def copy(self):
        g = _GS()
        for k in self.__slots__: setattr(g, k, getattr(self, k))
        return g


class Walker:
    """Interprets content streams. mode="redact" rewrites; mode="scan" only collects glyphs/images."""

    def __init__(self, pdf, rects: list[Rect], mode="redact", remove_invisible_text=False, fill_rgb=None):
        self.pdf, self.rects, self.mode = pdf, rects, mode
        self.remove_invisible = remove_invisible_text
        self.pix = tuple(int(round(max(0, min(1, c)) * 255)) for c in fill_rgb) if fill_rgb else (255, 255, 255)
        self.fonts: dict = {}
        self.stats = {"glyphs_removed": 0, "paths_removed": 0, "images_redacted": 0, "images_removed": 0,
                      "inline_images_removed": 0, "actual_text_removed": 0, "invisible_glyphs_removed": 0}
        self.glyphs: list[dict] = []   # scan mode
        self.images: list[dict] = []   # scan mode
        self._img_cache: dict = {}
        self._depth = 0
        self._stack_ids: list = []

    def font(self, fd) -> Font:
        key = fd.objgen if fd is not None and getattr(fd, "is_indirect", False) else id(fd)
        f = self.fonts.get(key)
        if f is None:
            try: f = Font(fd)
            except Exception: f = Font(None)
            self.fonts[key] = f
        return f

    def hit(self, r: Rect) -> bool: return any(overlaps(r, R) for R in self.rects)

    # --- returns (new_instructions, changed)
    def run(self, instrs, resources, ctm=IDENT):
        gs, stack = _GS(), []
        gs.ctm = ctm
        out, changed = [], False
        path: list = []; path_ops_start = None; clip_pending = False
        tm = tlm = IDENT
        bdc_stack: list = []  # entries: index into out of a BDC with replacement text, or None
        dirty_bdc: set = set()
        res = resources if isinstance(resources, Dictionary) else Dictionary()
        fonts = res.get("/Font") if isinstance(res.get("/Font"), Dictionary) else Dictionary()
        xobjs = res.get("/XObject") if isinstance(res.get("/XObject"), Dictionary) else Dictionary()
        new_xobjs: dict = {}

        for ins in instrs:
            if isinstance(ins, pikepdf.ContentStreamInlineImage):
                b = box_of(gs.ctm, 0, 0, 1, 1)
                if self.mode == "scan":
                    self.images.append({"rect": list(b), "inline": True}); out.append(ins); continue
                if self.hit(b): self.stats["inline_images_removed"] += 1; changed = True; continue
                out.append(ins); continue
            ops, op = list(ins.operands), str(ins.operator)
            emit = True
            if op == "q": stack.append(gs.copy())
            elif op == "Q": gs = stack.pop() if stack else gs
            elif op == "cm" and len(ops) == 6: gs.ctm = mul(tuple(_num(x) for x in ops), gs.ctm)
            elif op == "w" and ops: gs.lw = _num(ops[0], 1.0)
            elif op == "BT": tm = tlm = IDENT
            elif op == "Tc" and ops: gs.tc = _num(ops[0])
            elif op == "Tw" and ops: gs.tw = _num(ops[0])
            elif op == "Tz" and ops: gs.tz = _num(ops[0], 100)
            elif op == "TL" and ops: gs.tl = _num(ops[0])
            elif op == "Ts" and ops: gs.ts = _num(ops[0])
            elif op == "Tr" and ops: gs.tr = int(_num(ops[0]))
            elif op == "Tf" and len(ops) == 2:
                gs.font = self.font(fonts.get(str(ops[0])) if isinstance(ops[0], Name) else None); gs.fs = _num(ops[1])
            elif op in ("Td", "TD") and len(ops) == 2:
                tx, ty = _num(ops[0]), _num(ops[1])
                if op == "TD": gs.tl = -ty
                tlm = mul((1, 0, 0, 1, tx, ty), tlm); tm = tlm
            elif op == "Tm" and len(ops) == 6: tlm = tm = tuple(_num(x) for x in ops)
            elif op == "T*": tlm = mul((1, 0, 0, 1, 0, -gs.tl), tlm); tm = tlm
            elif op in ("Tj", "TJ", "'", '"'):
                if op == "'" or op == '"':
                    if op == '"' and len(ops) == 3: gs.tw, gs.tc = _num(ops[0]), _num(ops[1])
                    tlm = mul((1, 0, 0, 1, 0, -gs.tl), tlm); tm = tlm
                    elems = [ops[-1]] if ops else []
                else:
                    elems = list(ops[0]) if op == "TJ" and ops and isinstance(ops[0], Array) else ops[:1]
                new_elems, removed, tm = self._text(elems, gs, tm)
                if removed:
                    changed = True
                    for idx in bdc_stack:
                        if idx is not None: dirty_bdc.add(idx)
                    if op == "'" : out.append(pikepdf.ContentStreamInstruction([], Operator("T*")))
                    elif op == '"':
                        out += [pikepdf.ContentStreamInstruction([ops[0]], Operator("Tw")), pikepdf.ContentStreamInstruction([ops[1]], Operator("Tc")),
                                pikepdf.ContentStreamInstruction([], Operator("T*"))]
                    if new_elems: out.append(pikepdf.ContentStreamInstruction([Array(new_elems)], Operator("TJ")))
                    emit = False
            elif op in ("m", "l") and len(ops) == 2:
                if op == "m" and path_ops_start is None: path_ops_start = len(out)
                path.append(tp(gs.ctm, _num(ops[0]), _num(ops[1])))
            elif op == "c" and len(ops) == 6: path += [tp(gs.ctm, _num(ops[i]), _num(ops[i + 1])) for i in (0, 2, 4)]
            elif op in ("v", "y") and len(ops) == 4: path += [tp(gs.ctm, _num(ops[i]), _num(ops[i + 1])) for i in (0, 2)]
            elif op == "re" and len(ops) == 4:
                if path_ops_start is None: path_ops_start = len(out)
                x, y, w, h = (_num(v) for v in ops)
                path += [tp(gs.ctm, x, y), tp(gs.ctm, x + w, y), tp(gs.ctm, x, y + h), tp(gs.ctm, x + w, y + h)]
            elif op in ("W", "W*"): clip_pending = True
            elif op in PATH_END:
                if op in PAINT and path and self.mode == "redact":
                    b = bbox(path)
                    sc = math.sqrt(abs(gs.ctm[0] * gs.ctm[3] - gs.ctm[1] * gs.ctm[2])) or 1
                    pad = (gs.lw * sc / 2) if op not in ("f", "F", "f*") else 0
                    b = (b[0] - pad, b[1] - pad, b[2] + pad, b[3] + pad)
                    for R in self.rects:
                        if touches(b, R) and not contains(b, R):
                            if not clip_pending and path_ops_start is not None:
                                del out[path_ops_start:]  # drop the path's coordinates too, not just its painting
                            else:
                                out.append(pikepdf.ContentStreamInstruction([], Operator("n")))
                            emit = False
                            self.stats["paths_removed"] += 1; changed = True; break
                path = []; path_ops_start = None; clip_pending = False
            elif op == "Do" and ops and isinstance(ops[0], Name):
                xo = xobjs.get(str(ops[0]))
                r = self._do(str(ops[0]), xo, gs, new_xobjs)
                if r == "drop": emit = False; changed = True
                elif isinstance(r, str): out.append(pikepdf.ContentStreamInstruction([Name(r)], Operator("Do"))); emit = False; changed = True
            elif op == "BDC" and len(ops) == 2:
                d = ops[1]
                bdc_stack.append(len(out) if isinstance(d, Dictionary) and any(k in d for k in ("/ActualText", "/Alt", "/E")) else None)
            elif op == "BMC": bdc_stack.append(None)
            elif op == "EMC":
                if bdc_stack: bdc_stack.pop()
            if emit: out.append(ins)

        for idx in dirty_bdc:
            ins = out[idx]; d = Dictionary({k: v for k, v in ins.operands[1].items() if k not in ("/ActualText", "/Alt", "/E")})
            out[idx] = pikepdf.ContentStreamInstruction([ins.operands[0], d], Operator("BDC")); self.stats["actual_text_removed"] += 1; changed = True
        return out, changed, new_xobjs

    def _text(self, elems, gs: _GS, tm):
        f = gs.font or self.font(None); fs, th = gs.fs, gs.tz / 100
        trm0 = mul(tm, gs.ctm)
        x = 0.0; new, removed_any, buf = [], False, bytearray()
        invisible = self.remove_invisible and gs.tr == 3

        def flush():
            if buf: new.append(String(bytes(buf))); buf.clear()

        def push_num(n):
            if new and not isinstance(new[-1], String) and not buf: new[-1] = new[-1] + n
            else: flush(); new.append(n)
        for el in elems:
            if isinstance(el, String):
                for code in f.codes(bytes(el)):
                    w0 = f.width(code)
                    sp = gs.tw if len(code) == 1 and code == b" " else 0.0
                    adv = (w0 * fs + gs.tc + sp) * th
                    gw = max(w0 * fs * th, 0.3 * abs(fs) * th) if abs(fs) > 0 else 0.0
                    full = box_of(trm0, x, gs.ts + f.desc * fs, x + gw, gs.ts + f.asc * fs)
                    origin = tp(trm0, x, gs.ts)
                    if self.mode == "scan":
                        self.glyphs.append({"u": f.unicode(code), "box": full, "origin": origin, "fs": abs(fs) * math.sqrt(abs(trm0[0] * trm0[3] - trm0[1] * trm0[2]) or 1),
                                            "dir": (trm0[0], trm0[1])})
                        x += adv; continue
                    core = box_of(trm0, x + 0.15 * gw, gs.ts + 0.0 * fs, x + 0.85 * gw, gs.ts + 0.55 * fs * (f.asc / 0.8 if f.asc else 1))
                    kill = invisible or any(overlaps(core, R) or inside(origin, R) and overlaps(full, R) for R in self.rects)
                    if kill:
                        removed_any = True
                        self.stats["invisible_glyphs_removed" if invisible and not any(overlaps(core, R) for R in self.rects) else "glyphs_removed"] += 1
                        if fs: push_num(-(adv / th) * 1000 / fs if th else 0)
                    else:
                        buf.extend(code)
                    x += adv
            else:
                n = _num(el)
                x -= n / 1000 * fs * th
                if self.mode != "scan":
                    if buf: flush(); new.append(n)
                    else: push_num(n)
        flush()
        # drop trailing/leading pure numbers only if nothing visible remains -> keep displacement (affects following text)
        tm = mul((1, 0, 0, 1, x, 0), tm)
        if not removed_any: return elems, False, tm
        new = [e if isinstance(e, String) else (round(float(e), 4)) for e in new]
        return new, True, tm

    def _new_name(self, xobjs, new_xobjs, prefix="TPRd"):
        i = 1
        while f"/{prefix}{i}" in xobjs or f"/{prefix}{i}" in new_xobjs: i += 1
        return f"/{prefix}{i}"

    def _do(self, name, xo, gs, new_xobjs):
        if not isinstance(xo, Stream): return None
        st = str(xo.get("/Subtype", ""))
        if st == "/Image":
            b = box_of(gs.ctm, 0, 0, 1, 1)
            if self.mode == "scan":
                self.images.append({"rect": list(b), "width": int(_num(xo.get("/Width", 0))), "height": int(_num(xo.get("/Height", 0))), "name": name}); return None
            hits = [R for R in self.rects if overlaps(b, R)]
            if not hits: return None
            if any(contains(R, b) for R in hits): self.stats["images_removed"] += 1; return "drop"
            new = self._redact_image(xo, gs.ctm, hits)
            if new is None: self.stats["images_removed"] += 1; return "drop"
            nm = self._new_name(self._cur_xobjs, new_xobjs); new_xobjs[nm] = new; self.stats["images_redacted"] += 1
            return nm
        if st == "/Form":
            if self._depth >= MAX_DEPTH: return None
            key = xo.objgen if xo.is_indirect else None
            if key and key in self._stack_ids: return None  # cycle
            m = xo.get("/Matrix"); fm = tuple(_num(v) for v in m) if isinstance(m, Array) and len(m) == 6 else IDENT
            ctm = mul(fm, gs.ctm)
            if self.mode == "redact" and not self.remove_invisible:
                bb = xo.get("/BBox")
                if isinstance(bb, Array) and len(bb) == 4:
                    fb = box_of(ctm, *(_num(v) for v in bb))
                    if not any(touches(fb, R) for R in self.rects): return None
            res = xo.get("/Resources")
            self._depth += 1; self._stack_ids.append(key)
            saved = getattr(self, "_cur_xobjs", Dictionary())
            try:
                instrs = pikepdf.parse_content_stream(xo)
                new_ins, changed, nx = self.process(instrs, res if isinstance(res, Dictionary) else self._parent_res, ctm)
            except Exception:
                if self.mode == "scan": return None
                # unparseable form under a mark: remove the whole drawing (safe default)
                self.stats["images_removed"] += 0; return "drop"
            finally:
                self._depth -= 1; self._stack_ids.pop(); self._cur_xobjs = saved
            if self.mode == "scan" or not changed: return None
            d = Dictionary({k: v for k, v in xo.items() if k not in ("/Length", "/Filter", "/DecodeParms", "/Resources")})
            nres = Dictionary(dict(res.items())) if isinstance(res, Dictionary) else (Dictionary(dict(self._parent_res.items())) if isinstance(self._parent_res, Dictionary) else Dictionary())
            if nx:
                xd = nres.get("/XObject"); xd = Dictionary(dict(xd.items())) if isinstance(xd, Dictionary) else Dictionary()
                for k, v in nx.items(): xd[k] = v
                nres["/XObject"] = xd
            ns = Stream(self.pdf, pikepdf.unparse_content_stream(new_ins))
            for k, v in d.items(): ns[k] = v
            ns["/Resources"] = nres
            nm = self._new_name(self._cur_xobjs, new_xobjs, "TPRdF"); new_xobjs[nm] = self.pdf.make_indirect(ns)
            return nm
        return None

    def process(self, instrs, resources, ctm=IDENT):
        """Entry used for pages and forms: tracks the XObject dict for name allocation."""
        res = resources if isinstance(resources, Dictionary) else Dictionary()
        prev_parent = getattr(self, "_parent_res", None)
        self._parent_res = res
        self._cur_xobjs = res.get("/XObject") if isinstance(res.get("/XObject"), Dictionary) else Dictionary()
        try: return self.run(instrs, res, ctm)
        finally: self._parent_res = prev_parent

    def _redact_image(self, xo, ctm, hits):
        if bool(xo.get("/ImageMask", False)): return None
        try:
            from pikepdf import PdfImage
            pim = PdfImage(xo); img = pim.as_pil_image()
        except Exception:
            return None
        W, H = img.size
        iv = inv(ctm)
        if iv is None or not W or not H: return None
        boxes = []
        for R in hits:
            us = [tp(iv, x, y) for x, y in ((R[0], R[1]), (R[2], R[1]), (R[0], R[3]), (R[2], R[3]))]
            u0, v0, u1, v1 = bbox(us)
            u0, u1, v0, v1 = max(0, u0), min(1, u1), max(0, v0), min(1, v1)
            if u1 <= u0 or v1 <= v0: continue
            c0, c1 = max(0, math.floor(u0 * W) - 1), min(W, math.ceil(u1 * W) + 1)
            r0, r1 = max(0, math.floor((1 - v1) * H) - 1), min(H, math.ceil((1 - v0) * H) + 1)
            boxes.append((c0, r0, c1, r1))
        if not boxes: return None
        from PIL import ImageDraw
        mode = img.mode
        if mode not in ("RGB", "L", "CMYK"): img = img.convert("RGB"); mode = "RGB"
        dr = ImageDraw.Draw(img)
        r, g, b = self.pix
        col = {"RGB": (r, g, b), "L": int(round(0.299 * r + 0.587 * g + 0.114 * b)),
               "CMYK": (0, 0, 0, 255) if (r, g, b) == (0, 0, 0) else (255 - r, 255 - g, 255 - b, 0)}[mode]
        for bx in boxes: dr.rectangle([bx[0], bx[1], bx[2] - 1, bx[3] - 1], fill=col)
        cs = {"RGB": Name.DeviceRGB, "L": Name.DeviceGray, "CMYK": Name.DeviceCMYK}[mode]
        ns = Stream(self.pdf, img.tobytes())  # written unfiltered; qpdf Flate-compresses on save
        ns["/Type"] = Name.XObject; ns["/Subtype"] = Name.Image; ns["/Width"] = W; ns["/Height"] = H
        ns["/ColorSpace"] = cs; ns["/BitsPerComponent"] = 8
        if "/Interpolate" in xo: ns["/Interpolate"] = xo["/Interpolate"]
        sm = xo.get("/SMask")
        if isinstance(sm, Stream):
            try:
                mimg = PdfImage(sm).as_pil_image().convert("L")
                if mimg.size == (W, H):
                    md = ImageDraw.Draw(mimg)
                    for bx in boxes: md.rectangle([bx[0], bx[1], bx[2] - 1, bx[3] - 1], fill=255)
                    ms = Stream(self.pdf, mimg.tobytes())
                    for k, v in (("/Type", Name.XObject), ("/Subtype", Name.Image), ("/Width", W), ("/Height", H),
                                 ("/ColorSpace", Name.DeviceGray), ("/BitsPerComponent", 8)): ms[k] = v
                    ns["/SMask"] = self.pdf.make_indirect(ms)
            except Exception:
                pass  # mask dropped: image becomes opaque, still redacted
        return self.pdf.make_indirect(ns)


# ---------------------------------------------------------------- page-level operations
def _page_box(pg) -> Rect:
    box = pg.obj.get("/CropBox") or pg.mediabox
    return norm_rect([_num(v) for v in box])


def _remove_fields(pdf, widgets: list):
    acro = pdf.Root.get("/AcroForm")
    if not isinstance(acro, Dictionary) or not widgets: return
    ids = {w.objgen for w in widgets if w.is_indirect}

    def prune(arr):
        keep = []
        for f in list(arr):
            try:
                if f.is_indirect and f.objgen in ids: continue
                kids = f.get("/Kids")
                if isinstance(kids, Array):
                    nk = prune(kids)
                    if not nk: continue
                    f["/Kids"] = Array(nk)
            except Exception: pass
            keep.append(f)
        return keep
    if isinstance(acro.get("/Fields"), Array): acro["/Fields"] = Array(prune(acro["/Fields"]))


def _remove_annots(pdf, pg, pred) -> int:
    annots = pg.obj.get("/Annots")
    if not isinstance(annots, Array): return 0
    gone, widgets, keep = set(), [], []
    for a in annots:
        try: rm = pred(a)
        except Exception: rm = False
        if rm:
            if a.is_indirect: gone.add(a.objgen)
            if str(a.get("/Subtype")) == "/Widget": widgets.append(a)
    for a in annots:
        try:
            if a.is_indirect and a.objgen in gone: continue
            par = a.get("/Parent")
            if str(a.get("/Subtype")) == "/Popup" and par is not None and par.is_indirect and par.objgen in gone: continue
        except Exception: pass
        keep.append(a)
    n = len(annots) - len(keep)
    if keep: pg.obj["/Annots"] = Array(keep)
    elif "/Annots" in pg.obj: del pg.obj["/Annots"]
    _remove_fields(pdf, widgets)
    return n


def _fill_ops(rects, rgb) -> bytes:
    if not rgb or not rects: return b""
    r, g, b = (max(0.0, min(1.0, float(c))) for c in rgb)
    s = f"q {r:.4f} {g:.4f} {b:.4f} rg\n"
    for x0, y0, x1, y1 in rects: s += f"{x0:.3f} {y0:.3f} {x1 - x0:.3f} {y1 - y0:.3f} re f\n"
    return (s + "Q\n").encode()


def _own_resources(pdf, pg):
    """Pages may share one Resources dict; give this page its own shallow copy before renaming XObjects."""
    res = pg.obj.get("/Resources")
    nres = Dictionary(dict(res.items())) if isinstance(res, Dictionary) else Dictionary()
    if isinstance(nres.get("/XObject"), Dictionary): nres["/XObject"] = Dictionary(dict(nres["/XObject"].items()))
    pg.obj["/Resources"] = nres
    return nres


def _rewrite_page(pdf, pg, rects, fill_rgb, remove_invisible):
    w = Walker(pdf, rects, "redact", remove_invisible, fill_rgb)
    res = _own_resources(pdf, pg)
    try:
        instrs = pikepdf.parse_content_stream(pg)
    except Exception:
        raise EngineError("REDACT_UNPARSEABLE_PAGE", "A page's content could not be parsed; use whole-page redaction for it")
    new, changed, nx = w.process(instrs, res)
    if nx:
        xd = res.get("/XObject") if isinstance(res.get("/XObject"), Dictionary) else Dictionary()
        for k, v in nx.items(): xd[k] = v
        res["/XObject"] = xd
    body = pikepdf.unparse_content_stream(new)
    pg.obj["/Contents"] = pdf.make_stream(b"q\n" + body + b"\nQ\n" + _fill_ops(rects, fill_rgb))
    return w.stats


def _wipe_page(pdf, pg, fill_rgb):
    box = _page_box(pg)
    _remove_annots(pdf, pg, lambda a: True)
    pg.obj["/Resources"] = Dictionary()
    for k in ("/Thumb", "/PieceInfo", "/Metadata", "/AF", "/B", "/StructParents"):
        if k in pg.obj: del pg.obj[k]
    pg.obj["/Contents"] = pdf.make_stream(_fill_ops([box], fill_rgb))


def redact(data: bytes, marks: list[dict], fill_rgb=(0.0, 0.0, 0.0), sanitize_opts: dict | None = None) -> tuple[bytes, dict]:
    """marks: [{"page": 1-based, "rect": [x0,y0,x1,y1] in PDF user space} | {"page": n, "whole_page": True}]."""
    pdf = open_pdf(data); n = len(pdf.pages)
    if not marks and not sanitize_opts: raise EngineError("INVALID_REQUEST", "Nothing to redact")
    _check_pages(n, [int(m.get("page", 0)) for m in marks])
    by_page: dict[int, list[Rect]] = {}; whole: set[int] = set()
    for m in marks:
        p = int(m["page"])
        if m.get("whole_page"): whole.add(p); continue
        r = norm_rect(m.get("rect") or [0, 0, 0, 0])
        if r[2] - r[0] <= 0 or r[3] - r[1] <= 0: raise EngineError("INVALID_REQUEST", "Redaction rectangles must have a positive area")
        by_page.setdefault(p, []).append(r)
    signed = bool(isinstance(pdf.Root.get("/AcroForm"), Dictionary) and int(_num(pdf.Root.AcroForm.get("/SigFlags", 0))) & 1)
    rep = {"pages_redacted": sorted(set(by_page) | whole), "whole_pages": sorted(whole), "areas": sum(len(v) for v in by_page.values()),
           "glyphs_removed": 0, "paths_removed": 0, "images_redacted": 0, "images_removed": 0, "inline_images_removed": 0,
           "annotations_removed": 0, "actual_text_removed": 0, "invisible_glyphs_removed": 0, "warnings": []}
    if signed: rep["warnings"].append("This document had digital signatures; they no longer validate after redaction.")
    for p in sorted(whole):
        _wipe_page(pdf, pdf.pages[p - 1], fill_rgb)
    for p, rects in sorted(by_page.items()):
        if p in whole: continue
        pg = pdf.pages[p - 1]
        st = _rewrite_page(pdf, pg, rects, fill_rgb, False)
        for k, v in st.items(): rep[k] = rep.get(k, 0) + v
        rep["annotations_removed"] += _remove_annots(pdf, pg, lambda a: isinstance(a.get("/Rect"), Array) and any(touches(norm_rect([_num(v) for v in a.Rect]), R) for R in rects))
        if "/Thumb" in pg.obj: del pg.obj["/Thumb"]
    if sanitize_opts:
        rep["sanitized"] = _sanitize(pdf, sanitize_opts, rep)
    pdf.remove_unreferenced_resources()
    out = _save(pdf, compress_streams=True, object_stream_mode=pikepdf.ObjectStreamMode.generate)
    open_pdf(out)  # verify the result re-opens
    return out, rep


# ---------------------------------------------------------------- sanitize ("Remove hidden information")
SANITIZE_KEYS = ("metadata", "javascript", "attachments", "comments", "forms", "hidden_text", "links_actions")
_DANGEROUS_S = {"/JavaScript", "/Launch", "/SubmitForm", "/ImportData", "/Rendition", "/Sound", "/Movie", "/RichMediaExecute", "/GoToE"}


def _sanitize(pdf, opts: dict, rep: dict) -> dict:
    o = {k: bool(opts.get(k, True)) for k in SANITIZE_KEYS}
    done: dict = {}
    root = pdf.Root
    if o["forms"] and isinstance(root.get("/AcroForm"), Dictionary):
        try:
            root.AcroForm.NeedAppearances = True
            pdf.generate_appearance_streams()
            pdf.flatten_annotations(mode="all")
        except Exception: pass
        for pg in pdf.pages: _remove_annots(pdf, pg, lambda a: str(a.get("/Subtype")) == "/Widget")
        if "/AcroForm" in root: del root["/AcroForm"]
        done["forms"] = "flattened (visible values kept as page content), interactive fields and XFA removed"
    if o["hidden_text"]:
        cnt = 0
        for pg in pdf.pages:
            try:
                w = Walker(pdf, [], "redact", remove_invisible_text=True)
                res = _own_resources(pdf, pg)
                new, changed, nx = w.process(pikepdf.parse_content_stream(pg), res)
                if changed:
                    if nx:
                        xd = res.get("/XObject") if isinstance(res.get("/XObject"), Dictionary) else Dictionary()
                        for k, v in nx.items(): xd[k] = v
                        res["/XObject"] = xd
                    pg.obj["/Contents"] = pdf.make_stream(pikepdf.unparse_content_stream(new))
                cnt += w.stats["invisible_glyphs_removed"]
            except Exception: continue
        rep["invisible_glyphs_removed"] = rep.get("invisible_glyphs_removed", 0) + cnt
        done["hidden_text"] = f"{cnt} invisible glyphs removed (e.g. OCR text layers)"
    if o["comments"]:
        c = 0
        for pg in pdf.pages:
            c += _remove_annots(pdf, pg, lambda a: str(a.get("/Subtype")) not in ("/Widget", "/Link"))
        done["comments"] = f"{c} comments/markups removed"
    if o["attachments"]:
        names = root.get("/Names")
        if isinstance(names, Dictionary) and "/EmbeddedFiles" in names: del names["/EmbeddedFiles"]
        for d in [root] + [pg.obj for pg in pdf.pages]:
            if "/AF" in d: del d["/AF"]
        for pg in pdf.pages: _remove_annots(pdf, pg, lambda a: str(a.get("/Subtype")) == "/FileAttachment")
        done["attachments"] = "embedded files removed"
    if o["javascript"]:
        names = root.get("/Names")
        if isinstance(names, Dictionary) and "/JavaScript" in names: del names["/JavaScript"]
        for k in ("/OpenAction", "/AA"):
            if k in root: del root[k]
        for obj in list(pdf.objects):
            try:
                if not isinstance(obj, Dictionary) and not isinstance(obj, Stream): continue
                if "/AA" in obj: del obj["/AA"]
                for k in ("/A", "/Next"):
                    a = obj.get(k)
                    if isinstance(a, Dictionary) and str(a.get("/S")) in _DANGEROUS_S: del obj[k]
                if "/JS" in obj: del obj["/JS"]
            except Exception: continue
        done["javascript"] = "document/page/field scripts and launch/submit actions removed (never executed)"
    if o["metadata"]:
        for k in list(pdf.docinfo.keys()): del pdf.docinfo[k]
        for obj in list(pdf.objects):
            try:
                if isinstance(obj, (Dictionary, Stream)):
                    for k in ("/Metadata", "/PieceInfo"):
                        if k in obj: del obj[k]
            except Exception: continue
        for pg in pdf.pages:
            for k in ("/Metadata", "/PieceInfo", "/Thumb"):
                if k in pg.obj: del pg.obj[k]
        done["metadata"] = "document info, XMP metadata, private app data and page thumbnails removed"
    if o["links_actions"]:
        pass  # links are kept; only dangerous actions are removed by the javascript option
    return done


def sanitize(data: bytes, opts: dict | None = None) -> tuple[bytes, dict]:
    pdf = open_pdf(data); rep: dict = {"warnings": []}
    rep["sanitized"] = _sanitize(pdf, opts or {}, rep)
    pdf.remove_unreferenced_resources()
    out = _save(pdf, compress_streams=True, object_stream_mode=pikepdf.ObjectStreamMode.generate)
    open_pdf(out); return out, rep


# ---------------------------------------------------------------- search & image listing
PATTERNS = {
    "email": r"[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}",
    "phone": r"(?<!\d)(?:\+?\d{1,3}[\s.\-]?)?(?:\(\d{3}\)|\d{3})[\s.\-]?\d{3}[\s.\-]?\d{4}(?!\d)",
    "ssn": r"(?<!\d)\d{3}[- ]\d{2}[- ]\d{4}(?!\d)",
    "sin": r"(?<!\d)\d{3}[- ]\d{3}[- ]\d{3}(?!\d)",
    "credit_card": r"(?<!\d)(?:\d[ \-]?){12,18}\d(?!\d)",
    "postal_code": r"\b[ABCEGHJ-NPRSTVXY]\d[ABCEGHJ-NPRSTV-Z][ \-]?\d[ABCEGHJ-NPRSTV-Z]\d\b",
    "date": r"\b(?:\d{4}-\d{2}-\d{2}|\d{1,2}[/.\-]\d{1,2}[/.\-]\d{2,4})\b",
}


def _luhn(s: str) -> bool:
    d = [int(c) for c in s if c.isdigit()]
    if not 13 <= len(d) <= 19: return False
    t = 0
    for i, x in enumerate(reversed(d)):
        if i % 2: x = x * 2 - 9 if x * 2 > 9 else x * 2
        t += x
    return t % 10 == 0


def _page_glyphs(pdf, pg) -> list[dict]:
    w = Walker(pdf, [], "scan")
    try: w.process(pikepdf.parse_content_stream(pg), pg.obj.get("/Resources"))
    except Exception: return []
    return w.glyphs


def _layout(glyphs):
    """Content-order glyphs -> (text, index map) with virtual spaces/newlines for gaps and line changes."""
    text, idx = [], []
    prev = None
    for i, g in enumerate(glyphs):
        if prev is not None:
            fs = max(g["fs"], 1e-3)
            dx, dy = g["origin"][0] - prev["end"][0], g["origin"][1] - prev["end"][1]
            line_change = abs(dy) > 0.5 * fs or dx < -2 * fs
            if line_change: text.append("\n"); idx.append(None)
            elif dx > 0.2 * fs and not prev["u"].endswith(" ") and not g["u"].startswith(" "): text.append(" "); idx.append(None)
        u = g["u"] or "\ufffd"
        for ch in u: text.append(ch); idx.append(i)
        b = g["box"]
        prev = {"u": u, "end": (b[2], g["origin"][1]) if g["dir"][0] >= 0 else (b[0], g["origin"][1])}
    return "".join(text), idx


def _merge_line_boxes(boxes: list[Rect]) -> list[Rect]:
    out: list[list[float]] = []
    for b in boxes:
        if out:
            o = out[-1]; h = max(o[3] - o[1], b[3] - b[1], 1e-3)
            if abs(o[1] - b[1]) < 0.4 * h and abs(o[3] - b[3]) < 0.4 * h and b[0] <= o[2] + h:
                o[0], o[1], o[2], o[3] = min(o[0], b[0]), min(o[1], b[1]), max(o[2], b[2]), max(o[3], b[3]); continue
        out.append(list(b))
    return [tuple(round(v, 3) for v in o) for o in out]


_EVIL = re.compile(r"\((?:[^()\\]|\\.)*[+*}](?:[^()\\]|\\.)*\)\s*[+*{]")


def search_text(data: bytes, query: str | None = None, *, regex=False, case_sensitive=False, whole_word=False,
                patterns: list[str] | None = None, pages: list[int] | None = None, limit=2000) -> dict:
    pdf = open_pdf(data); n = len(pdf.pages)
    pages = pages or list(range(1, n + 1)); _check_pages(n, pages)
    exprs: list[tuple[str, re.Pattern]] = []
    flags = 0 if case_sensitive else re.IGNORECASE
    if query:
        if len(query) > 300: raise EngineError("INVALID_REQUEST", "Search text is too long (max 300 characters)")
        if regex and _EVIL.search(query): raise EngineError("REGEX_TOO_COMPLEX", "Nested repetition is not allowed in redaction patterns")
        pat = query if regex else re.escape(query).replace(r"\ ", r"\s+")
        if whole_word: pat = rf"(?<!\w)(?:{pat})(?!\w)"
        try: exprs.append(("query", re.compile(pat, flags)))
        except re.error as e: raise EngineError("INVALID_REGEX", f"Invalid pattern: {e}")
    for p in patterns or []:
        if p not in PATTERNS: raise EngineError("INVALID_REQUEST", f"Unknown pattern {p}", {"patterns": sorted(PATTERNS)})
        exprs.append((p, re.compile(PATTERNS[p], re.IGNORECASE if p == "postal_code" else 0)))
    if not exprs: raise EngineError("INVALID_REQUEST", "Provide a search text or at least one pattern")
    matches, truncated = [], False
    for p in pages:
        gl = _page_glyphs(pdf, pdf.pages[p - 1])
        if not gl: continue
        text, idx = _layout(gl)
        seen = set()
        for kind, rx in exprs:
            for m in rx.finditer(text):
                if m.end() <= m.start(): continue
                if kind == "credit_card" and not _luhn(m.group()): continue
                gi = sorted({idx[i] for i in range(m.start(), m.end()) if idx[i] is not None})
                if not gi or (p, gi[0], gi[-1]) in seen: continue
                seen.add((p, gi[0], gi[-1]))
                matches.append({"page": p, "text": m.group().replace("\n", " ")[:200], "kind": kind,
                                "rects": [list(r) for r in _merge_line_boxes([gl[i]["box"] for i in gi])]})
                if len(matches) >= limit: truncated = True; break
            if truncated: break
        if truncated: break
    return {"matches": matches, "truncated": truncated, "count": len(matches)}


def list_images(data: bytes, pages: list[int] | None = None) -> list[dict]:
    pdf = open_pdf(data); n = len(pdf.pages); pages = pages or list(range(1, n + 1)); _check_pages(n, pages)
    out = []
    for p in pages:
        pg = pdf.pages[p - 1]; w = Walker(pdf, [], "scan")
        try: w.process(pikepdf.parse_content_stream(pg), pg.obj.get("/Resources"))
        except Exception: continue
        box = _page_box(pg)
        for im in w.images:
            r = norm_rect(im["rect"])
            if r[2] - r[0] < 1 or r[3] - r[1] < 1 or not overlaps(r, box): continue
            out.append({"page": p, "rect": [round(v, 3) for v in r], "width": im.get("width"), "height": im.get("height"), "inline": bool(im.get("inline"))})
    return out
