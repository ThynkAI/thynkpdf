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
    # keep aspect ratio inside rect
    bw, bh = x1 - x0, y1 - y0; sc = min(bw / w, bh / h); dw, dh = w * sc, h * sc
    ox, oy = x0 + (bw - dw) / 2, y0 + (bh - dh) / 2
    name = pg.add_resource(img, Name.XObject, prefix="TSig")
    content = pikepdf.unparse_content_stream([([], Operator("q")), ([dw, 0, 0, dh, ox, oy], Operator("cm")),
                                              ([Name(name)], Operator("Do")), ([], Operator("Q"))])
    pg.contents_add(pdf.make_stream(b"q\n"), prepend=True)
    pg.contents_add(pdf.make_stream(b"Q\n" + content))
    return _save(pdf)


def stamp_text(data: bytes, page: int, rect, text: str, font: str = "Times-Italic") -> bytes:
    if font not in TYPED_FONTS: raise EngineError("EDIT_UNSUPPORTED_FONT", "Unsupported font", {"allowed": sorted(TYPED_FONTS)})
    x0, y0, x1, y1 = _rect(rect)
    from reportlab.pdfbase.pdfmetrics import stringWidth
    size = min((y1 - y0) * 0.7, 72.0)
    wd = stringWidth(text, font, size)
    if wd > (x1 - x0) - 4: size = size * ((x1 - x0) - 4) / wd
    return insert_text(data, page, text, x0 + 2, y0 + ((y1 - y0) - size) / 2 + size * 0.2, max(size, 4), font)
