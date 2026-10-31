"""Generate real PDF fixtures with reportlab (standard-14 unembedded fonts) + edge cases."""
from pathlib import Path
from reportlab.pdfgen import canvas
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
import glob
D = Path(__file__).parent / "fixtures"; D.mkdir(exist_ok=True)

def simple(name, pages=3):
    c = canvas.Canvas(str(D / name))
    c.setTitle("THYNKPDF Fixture"); c.setAuthor("thynkpdf-tests")
    for i in range(1, pages + 1):
        c.setFont("Helvetica", 14); c.drawString(72, 720, f"Invoice Number ACME-{i:03d}")
        c.drawString(72, 700, f"Page marker P{i}")
        c.setFont("Times-Roman", 12); c.drawString(72, 680, "Total due: 100 USD")
        c.showPage()
    c.save()

simple("simple-3page.pdf", 3); simple("simple-1page.pdf", 1)
ttf = (glob.glob("/usr/share/fonts/**/DejaVuSans.ttf", recursive=True) or [None])[0]
if ttf:
    pdfmetrics.registerFont(TTFont("DejaVu", ttf))
    c = canvas.Canvas(str(D / "embedded-font.pdf")); c.setFont("DejaVu", 14); c.drawString(72, 720, "Embedded subset font text"); c.showPage(); c.save()
c = canvas.Canvas(str(D / "no-text.pdf")); c.rect(100, 100, 200, 200, fill=1); c.showPage(); c.save()
(D / "malformed.pdf").write_bytes(b"%PDF-1.7\n1 0 obj << /Type /Catalog /Pages 2 0 R >>\n garbage \x00\xff trailer")
(D / "not-a-pdf.pdf").write_bytes(b"\x89PNG\r\n\x1a\n" + b"0" * 100)
print(sorted(p.name for p in D.iterdir()))
