"""Audit fixtures (real PDFs). Run: python make_audit_fixtures.py"""
from reportlab.pdfgen import canvas
from reportlab.lib.pagesizes import letter, A4, A3, landscape
from reportlab.lib.colors import black
from PIL import Image, ImageDraw
import pikepdf, os
D=os.path.join(os.path.dirname(__file__),"fixtures"); os.makedirs(D,exist_ok=True)
def p(n): return os.path.join(D,n)
# 1 large: 320 pages, unique words per page
c=canvas.Canvas(p("large-320.pdf"),pagesize=letter)
for i in range(1,321):
    c.setFont("Helvetica",14); c.drawString(72,720,f"Page {i} of 320 marker-{i:03d}")
    for j in range(30): c.drawString(72,690-j*20,f"Line {j} lorem ipsum dolor sit amet page {i}")
    if i==250: c.drawString(72,80,"needle-unique-word")
    c.showPage()
c.save()
# 2 mixed sizes + rotated
c=canvas.Canvas(p("mixed-rotated.pdf"))
for i,(sz) in enumerate([letter,landscape(A4),A3,(300,300),letter]):
    c.setPageSize(sz); c.setFont("Helvetica",18); c.drawString(40,sz[1]-60,f"MIXED page {i+1} size {int(sz[0])}x{int(sz[1])}"); c.showPage()
c.save()
pdf=pikepdf.open(p("mixed-rotated.pdf"),allow_overwriting_input=True); pdf.pages[1].Rotate=90; pdf.pages[4].Rotate=270; pdf.save(p("mixed-rotated.pdf"))
# 3 multi-font, multi-run
c=canvas.Canvas(p("multifont.pdf"),pagesize=letter)
y=720
for f in ["Helvetica","Times-Roman","Courier","Helvetica-Bold"]:
    c.setFont(f,14); c.drawString(72,y,f"Font {f}: The quick brown fox"); y-=30
t=c.beginText(72,560); t.setFont("Helvetica",14); t.textOut("Split"); t.setFont("Times-Roman",14); t.textOut("Run"); t.setFont("Helvetica",14); t.textOut(" Words here"); c.drawText(t)
c.showPage(); c.save()
# 4 scanned image-only
img=Image.new("RGB",(1275,1650),"white"); d=ImageDraw.Draw(img); d.text((100,100),"SCANNED INVOICE TOTAL 42",fill="black")
img.save(p("scan.png")); c=canvas.Canvas(p("scanned.pdf"),pagesize=letter); c.drawImage(p("scan.png"),0,0,612,792); c.showPage(); c.save(); os.remove(p("scan.png"))
# 5 acroform all types
c=canvas.Canvas(p("acroform-all.pdf"),pagesize=letter); f=c.acroForm
c.drawString(72,740,"Name"); f.textfield(name="name",x=150,y=730,width=200,height=20)
c.drawString(72,700,"Agree"); f.checkbox(name="agree",x=150,y=695,size=16)
c.drawString(72,660,"Color"); f.radio(name="color",value="red",x=150,y=655,selected=False); f.radio(name="color",value="blue",x=180,y=655,selected=False)
c.drawString(72,620,"Country"); f.choice(name="country",options=["Canada","USA","Mexico"],value="Canada",x=150,y=610,width=150,height=20)
c.drawString(72,580,"Notes"); f.textfield(name="notes",x=150,y=500,width=300,height=70,fieldFlags="multiline")
c.showPage(); c.save()
# 6 compressible-poor (already tiny) and long filename copy
c=canvas.Canvas(p("tiny.pdf")); c.drawString(72,720,"tiny"); c.showPage(); c.save()
import shutil; shutil.copy(p("multifont.pdf"),p("Quarterly-financial-report-for-the-board-of-directors-final-revised-version-2026-copy-with-a-very-long-name.pdf"))
print(sorted(os.listdir(D)))
