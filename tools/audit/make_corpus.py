"""Generate the synthetic audit corpus into tools/audit/corpus/ (gitignored output). All content is synthetic.
Usage: python tools/audit/make_corpus.py [--large-pages N]"""
import io, sys, zlib, argparse, datetime
from pathlib import Path
import pikepdf
from pikepdf import Pdf, Dictionary, Name, Array, String
from reportlab.pdfgen import canvas
from reportlab.lib.pagesizes import letter, A4, landscape
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfbase.cidfonts import UnicodeCIDFont
from PIL import Image, ImageDraw

OUT = Path(__file__).resolve().parent / "corpus"; OUT.mkdir(exist_ok=True)
DEJAVU = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"

def rl(name, draw, size=letter):
    b = io.BytesIO(); c = canvas.Canvas(b, pagesize=size); draw(c); c.save(); (OUT / name).write_bytes(b.getvalue()); return b.getvalue()

def std_text(c):
    for i in range(3):
        c.setFont("Helvetica", 12); c.drawString(72, 700, f"Synthetic page {i+1} Hello World")
        c.drawString(72, 680, "Invoice total 1234.56 CAD"); c.setFont("Times-Roman", 14); c.drawString(72, 650, "Second font line"); c.showPage()

def two_runs(c):  # two Tj in the same BT without Td between: used to test move_text side effects
    c.setFont("Helvetica", 12); t = c.beginText(72, 700); t.textOut("Alpha "); t.textOut("Beta"); c.drawText(t); c.showPage()

def accented(c):
    c.setFont("Helvetica", 12); c.drawString(72, 700, "Café crème à Montréal, Zürich, naïve façade"); c.showPage()

def embedded(c):
    pdfmetrics.registerFont(TTFont("DejaVu", DEJAVU)); c.setFont("DejaVu", 12)
    c.drawString(72, 700, "Embedded subset font text"); c.drawString(72, 680, "Łódź Ελληνικά Русский"); c.showPage()

def cid(c):
    pdfmetrics.registerFont(UnicodeCIDFont("HeiseiMin-W3")); c.setFont("HeiseiMin-W3", 14); c.drawString(72, 700, "日本語のテキスト"); c.showPage()

def mixed(c):
    for sz in (letter, A4, landscape(letter), (300, 300)):
        c.setPageSize(sz); c.setFont("Helvetica", 12); c.drawString(20, 40, f"size {sz[0]:.0f}x{sz[1]:.0f}"); c.showPage()

def acro(c):
    c.setFont("Helvetica", 12); c.drawString(72, 720, "Synthetic form")
    f = c.acroForm
    f.textfield(name="full_name", x=72, y=650, width=200, height=20, value="")
    f.checkbox(name="agree", x=72, y=600, size=14, checked=False)
    f.choice(name="country", x=72, y=550, width=150, height=20, options=["Canada", "France"], value="Canada")
    c.showPage()

def scan_pdf():
    im = Image.new("L", (1275, 1650), 255); d = ImageDraw.Draw(im); d.text((100, 100), "SCANNED SYNTHETIC TEXT", fill=0)
    b = io.BytesIO(); im.save(b, "PDF", resolution=150); (OUT / "scan_image_only.pdf").write_bytes(b.getvalue())

def big_image(c):  # compressible content: an uncompressed-ish noisy image
    import random
    random.seed(1)
    im = Image.new("RGB", (1200, 1200)); px = im.load()
    for y in range(0, 1200, 4):
        for x in range(0, 1200, 4):
            v = (x * y) % 255; px[x, y] = (v, 255 - v, (x + y) % 255)
    p = OUT / "_img.png"; im.save(p); c.drawImage(str(p), 50, 100, 500, 500); c.showPage()

def main():
    ap = argparse.ArgumentParser(); ap.add_argument("--large-pages", type=int, default=2000); a = ap.parse_args()
    rl("std_text.pdf", std_text); rl("two_runs.pdf", two_runs); rl("accented.pdf", accented); rl("embedded_subset.pdf", embedded)
    rl("cid_cjk.pdf", cid); rl("mixed_sizes.pdf", mixed); rl("acroform.pdf", acro); rl("image_heavy.pdf", big_image); scan_pdf()
    # rotated pages
    pdf = Pdf.open(OUT / "mixed_sizes.pdf"); pdf.pages[1].rotate(90, relative=True); pdf.pages[2].rotate(270, relative=True); pdf.save(OUT / "rotated.pdf")
    # annotations + link + bookmarks + attachment + JavaScript
    pdf = Pdf.open(OUT / "std_text.pdf")
    for i, pg in enumerate(pdf.pages):
        txt = pdf.make_indirect(Dictionary(Type=Name.Annot, Subtype=Name.Text, Rect=[400, 700, 420, 720], Contents=String(f"note {i+1}"), NM=String(f"n{i}")))
        lnk = pdf.make_indirect(Dictionary(Type=Name.Annot, Subtype=Name.Link, Rect=[72, 690, 200, 712], Border=[0, 0, 0],
                                           A=Dictionary(S=Name.URI, URI=String("https://example.com/synthetic"))))
        pg.obj.Annots = pdf.make_indirect(Array([txt, lnk]))
    with pdf.open_outline() as ol:
        ol.root.extend([pikepdf.OutlineItem(f"Chapter {i+1}", i) for i in range(3)])
    pdf.attachments["synthetic.txt"] = pikepdf.AttachedFileSpec(pdf, b"synthetic attachment", mime_type="text/plain")
    pdf.Root.OpenAction = Dictionary(S=Name.JavaScript, JS=String("app.alert('synthetic');"))
    pdf.save(OUT / "annots_links_bookmarks_attach_js.pdf")
    # encrypted
    Pdf.open(OUT / "std_text.pdf").save(OUT / "encrypted_userpw.pdf", encryption=pikepdf.Encryption(owner="owner-synth", user="user-synth", R=6))
    Pdf.open(OUT / "std_text.pdf").save(OUT / "encrypted_ownerpw_only.pdf", encryption=pikepdf.Encryption(owner="owner-synth", user="", R=6))
    # malformed / truncated
    good = (OUT / "std_text.pdf").read_bytes()
    (OUT / "truncated.pdf").write_bytes(good[: len(good) // 2])
    (OUT / "garbage_after_header.pdf").write_bytes(b"%PDF-1.7\n" + bytes(range(256)) * 50)
    (OUT / "no_pages.pdf").write_bytes(_no_pages())
    # decompression bomb: one 512 MiB zero stream (~0.5 MiB compressed) as page content
    pdf = Pdf.new(); pdf.add_blank_page()
    pdf.pages[0].obj.Contents = pdf.make_stream(zlib.compress(b" " * (512 << 20), 9), Filter=Name.FlateDecode)
    pdf.save(OUT / "flate_bomb_512MiB.pdf", compress_streams=False)
    # large: N text pages
    b = io.BytesIO(); c = canvas.Canvas(b, pagesize=letter)
    for i in range(a.large_pages):
        c.setFont("Helvetica", 10)
        for j in range(40): c.drawString(50, 750 - j * 18, f"Large synthetic document page {i+1} line {j+1} lorem ipsum dolor sit amet")
        c.showPage()
    c.save(); (OUT / f"large_{a.large_pages}p.pdf").write_bytes(b.getvalue())
    # XXE inside XFA (must be rejected / not resolved)
    pdf = Pdf.open(OUT / "acroform.pdf")
    xxe = b'<?xml version="1.0"?><!DOCTYPE x [<!ENTITY e SYSTEM "file:///etc/hostname">]><xdp:xdp xmlns:xdp="http://ns.adobe.com/xdp/"><template xmlns="http://www.xfa.org/schema/xfa-template/3.3/"><subform name="f"><field name="a"><value><text>&e;</text></value></field></subform></template><xfa:datasets xmlns:xfa="http://www.xfa.org/schema/xfa-data/1.0/"><xfa:data><f><a>&e;</a></f></xfa:data></xfa:datasets></xdp:xdp>'
    pdf.Root.AcroForm.XFA = pdf.make_stream(xxe); pdf.save(OUT / "xfa_xxe.pdf")
    print("corpus:", sorted(p.name for p in OUT.glob("*.pdf")))

def _no_pages():
    return (b"%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[]/Count 0>>endobj\n"
            b"trailer<</Root 1 0 R>>\n%%EOF\n")

if __name__ == "__main__": main()
