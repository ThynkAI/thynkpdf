"""Builds a sample PDF for the redaction tests: standard-font text, an embedded TrueType font (when DejaVu is
installed), a photo-like raster image, vector line art, a comment, metadata, a JavaScript open action, an attachment
and an invisible (OCR-style) text layer. Coordinates are returned so tests can redact exact regions."""
import io, os
import pikepdf
from PIL import Image
from reportlab.pdfgen import canvas
from reportlab.lib.utils import ImageReader

TTF = next((p for p in ("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", "/usr/share/fonts/dejavu/DejaVuSans.ttf") if os.path.exists(p)), None)

SECRET = "SECRET-ACCOUNT-778899"
EMAIL = "jane.doe@example.com"
PHONE = "(519) 555-0142"
TTF_SECRET = "Ünïcode Geheimnis 4242"
HIDDEN = "INVISIBLE-OCR-LAYER-TOKEN"
IMG_RECT = (300, 400, 500, 600)  # x0, y0, x1, y1 on page 1


def image_png(w=200, h=200) -> bytes:
    im = Image.new("RGB", (w, h))
    px = im.load()
    for y in range(h):
        for x in range(w): px[x, y] = (40 + x % 200, 90 + y % 160, 200)
    b = io.BytesIO(); im.save(b, "PNG"); return b.getvalue()


def build() -> bytes:
    buf = io.BytesIO(); c = canvas.Canvas(buf, pagesize=(612, 792))
    c.setTitle("Confidential HR file"); c.setAuthor("Jane Doe"); c.setSubject("salary review")
    c.setFont("Helvetica", 12)
    c.drawString(72, 700, f"Public intro line. Account: {SECRET} end.")
    c.drawString(72, 680, f"Contact {EMAIL} or call {PHONE} today.")
    c.drawString(72, 660, "This line must stay readable after redaction.")
    if TTF:
        from reportlab.pdfbase import pdfmetrics
        from reportlab.pdfbase.ttfonts import TTFont
        pdfmetrics.registerFont(TTFont("DejaVu", TTF)); c.setFont("DejaVu", 12)
        c.drawString(72, 620, f"Embedded: {TTF_SECRET} done")
    c.setLineWidth(2); c.line(72, 560, 250, 560)  # line art crossing a redaction
    c.setFillColorRGB(0.9, 0.9, 0.9); c.rect(60, 500, 240, 30, fill=1, stroke=0)  # background box
    c.setFillColorRGB(0, 0, 0)
    c.drawImage(ImageReader(io.BytesIO(image_png())), IMG_RECT[0], IMG_RECT[1], IMG_RECT[2] - IMG_RECT[0], IMG_RECT[3] - IMG_RECT[1])
    t = c.beginText(72, 300); t.setTextRenderMode(3); t.setFont("Helvetica", 10); t.textLine(HIDDEN); c.drawText(t)
    c.showPage()
    c.setFont("Helvetica", 12); c.drawString(72, 700, f"Page two also mentions {SECRET}."); c.showPage()
    c.save()
    pdf = pikepdf.open(io.BytesIO(buf.getvalue()))
    pg = pdf.pages[0]
    pg.obj.Annots = pdf.make_indirect(pikepdf.Array([pdf.make_indirect(pikepdf.Dictionary(
        Type=pikepdf.Name.Annot, Subtype=pikepdf.Name.Text, Rect=[72, 690, 90, 710], Contents=pikepdf.String("Reviewer note: SSN 123-45-6789")))]))
    pdf.Root.OpenAction = pdf.make_indirect(pikepdf.Dictionary(S=pikepdf.Name.JavaScript, JS=pikepdf.String("app.alert('hi')")))
    pdf.attachments["notes.txt"] = pikepdf.AttachedFileSpec(pdf, b"attached secret", mime_type="text/plain")
    with pdf.open_metadata() as m: m["dc:creator"] = ["Jane Doe"]
    out = io.BytesIO(); pdf.save(out); return out.getvalue()


if __name__ == "__main__":
    import sys
    open(sys.argv[1] if len(sys.argv) > 1 else "redact-sample.pdf", "wb").write(build())
