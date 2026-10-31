"""Visual signature placement: draws a PNG (as image XObject with alpha SMask) or typed text into page content.
This is a visual mark, NOT a cryptographic signature."""
import io, zlib
import pikepdf
from pikepdf import Name, Dictionary, Operator
from .engine import EngineError, open_pdf, _check_pages, _save
from .edit import insert_text

MAX_PNG = 1_000_000
MAX_PIXELS = 4_000_000
TYPED_FONTS = {"Times-Italic", "Helvetica-Oblique", "Courier-Oblique", "Times-BoldItalic", "Helvetica"}


def png_info(png: bytes) -> tuple[int, int]:
    if len(png) > MAX_PNG: raise EngineError("FILE_TOO_LARGE", "Signature image exceeds 1 MB", {"max_bytes": MAX_PNG})
    if not png.startswith(b"\x89PNG\r\n\x1a\n"): raise EngineError("INVALID_FILE_TYPE", "Signature image must be PNG")
    from PIL import Image
    Image.MAX_IMAGE_PIXELS = MAX_PIXELS
    try:
        im = Image.open(io.BytesIO(png)); w, h = im.size
        if w * h > MAX_PIXELS: raise EngineError("IMAGE_TOO_LARGE", "Image dimensions too large")
        im.load()
    except EngineError: raise
    except Exception: raise EngineError("INVALID_FILE_TYPE", "PNG could not be decoded")
    return w, h


def _rect(r):
    if not r or len(r) != 4 or r[0] >= r[2] or r[1] >= r[3]: raise EngineError("INVALID_REQUEST", "rect = [x1,y1,x2,y2]")
    return [float(v) for v in r]


def page_rotation(pg) -> int:
    """Effective /Rotate (inherited from the page tree), normalised to 0/90/180/270."""
    o = pg.obj
    while o is not None:
        if "/Rotate" in o: return int(o.Rotate) % 360
        o = o.get("/Parent")
    return 0


_CS = {0: (1, 0), 90: (0, 1), 180: (-1, 0), 270: (0, -1)}


def stamp_image(data: bytes, page: int, rect, png: bytes) -> bytes:
    from PIL import Image
    png_info(png); x0, y0, x1, y1 = _rect(rect)
    im = Image.open(io.BytesIO(png)).convert("RGBA"); w, h = im.size
    pdf = open_pdf(data); _check_pages(len(pdf.pages), [page]); pg = pdf.pages[page - 1]
    rgb = im.convert("RGB").tobytes(); alpha = im.getchannel("A").tobytes()
    smask = pdf.make_stream(zlib.compress(alpha), Dictionary(Type=Name.XObject, Subtype=Name.Image, Width=w, Height=h,
                            ColorSpace=Name.DeviceGray, BitsPerComponent=8, Filter=Name.FlateDecode))
    img = pdf.make_stream(zlib.compress(rgb), Dictionary(Type=Name.XObject, Subtype=Name.Image, Width=w, Height=h,
                          ColorSpace=Name.DeviceRGB, BitsPerComponent=8, Filter=Name.FlateDecode, SMask=smask))
    # Counter-rotate by the page /Rotate so the stamp is upright as displayed; keep aspect ratio inside rect.
    rot = page_rotation(pg); c, s = _CS[rot]
    bw, bh = x1 - x0, y1 - y0
    ew, eh = (w, h) if rot in (0, 180) else (h, w)          # bbox of the rotated image in user space
    sc = min(bw / ew, bh / eh); iw, ih = w * sc, h * sc
    cx, cy = x0 + bw / 2, y0 + bh / 2
    e, f = cx - 0.5 * (iw * c - ih * s), cy - 0.5 * (iw * s + ih * c)
    name = pg.add_resource(img, Name.XObject, prefix="TSig")
    content = pikepdf.unparse_content_stream([([], Operator("q")), ([iw * c, iw * s, -ih * s, ih * c, e, f], Operator("cm")),
                                              ([Name(name)], Operator("Do")), ([], Operator("Q"))])
    pg.contents_add(pdf.make_stream(b"q\n"), prepend=True)
    pg.contents_add(pdf.make_stream(b"Q\n" + content))
    return _save(pdf)


def stamp_text(data: bytes, page: int, rect, text: str, font: str = "Times-Italic") -> bytes:
    if font not in TYPED_FONTS: raise EngineError("EDIT_UNSUPPORTED_FONT", "Unsupported font", {"allowed": sorted(TYPED_FONTS)})
    x0, y0, x1, y1 = _rect(rect)
    from reportlab.pdfbase.pdfmetrics import stringWidth
    pdf = open_pdf(data); _check_pages(len(pdf.pages), [page]); rot = page_rotation(pdf.pages[page - 1])
    W, H = (x1 - x0, y1 - y0) if rot in (0, 180) else (y1 - y0, x1 - x0)   # rect size as displayed
    size = min(H * 0.7, 72.0)
    wd = stringWidth(text, font, size)
    if wd > W - 4: size = size * (W - 4) / wd
    size = max(size, 4); off = (H - size) / 2 + size * 0.2      # baseline offset from the displayed bottom edge
    x, y = {0: (x0 + 2, y0 + off), 90: (x1 - off, y0 + 2), 180: (x1 - 2, y1 - off), 270: (x0 + off, y1 - 2)}[rot]
    return insert_text(data, page, text, x, y, size, font, rotate=rot)
