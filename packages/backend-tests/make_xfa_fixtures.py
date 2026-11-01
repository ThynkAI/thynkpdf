"""Generate original XFA fixtures: reportlab page(s) + pikepdf, with hand-written template/datasets packets.
Run: python packages/backend-tests/make_xfa_fixtures.py  (needs pythonpath packages/pdf-engine)."""
import io, sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "pdf-engine"))
from reportlab import rl_config
rl_config.invariant = 1
from reportlab.pdfgen import canvas
import pikepdf
from pikepdf import Name, Array, Dictionary, String
from thynkpdf_engine.forms import create_fields

D = Path(__file__).parent / "fixtures"
T = 'xmlns="http://www.xfa.org/schema/xfa-template/3.3/"'
X = 'xmlns:xfa="http://www.xfa.org/schema/xfa-data/1.0/"'
PRE, POST = b'<xdp:xdp xmlns:xdp="http://ns.adobe.com/xdp/">', b"</xdp:xdp>"

HYB_TPL = f'''<template {T}><subform name="form1" layout="position" w="8.5in" h="11in">
<field name="full_name" x="1in" y="1in" w="3in" h="0.3in"><ui><textEdit/></ui><caption><value><text>Full name</text></value></caption></field>
<field name="agree" x="1in" y="1.5in" w="0.2in" h="0.2in"><ui><checkButton/></ui><items><integer>1</integer><integer>0</integer></items></field>
<field name="country" x="1in" y="2in" w="2in" h="0.3in"><ui><choiceList/></ui><items><text>Canada</text><text>USA</text></items></field>
SCRIPT</subform></template>'''
HYB_DATA = f'<xfa:datasets {X}><xfa:data><form1><full_name>Jane Original</full_name><agree>0</agree><country>Canada</country></form1></xfa:data></xfa:datasets>'
SCRIPT = '<event activity="initialize"><script contentType="application/x-javascript">app.alert("pwned"); xfa.host.gotoURL("http://evil.example/")</script></event>'

DYN_TPL = f'''<template {T}><subform name="form1" layout="tb" w="7.5in">
<subform name="header" layout="position" w="7.5in" h="0.6in"><draw name="title" x="0" y="0" w="5in" h="0.4in"><value><text>Membership Application</text></value></draw></subform>
<field name="full_name" w="4in" h="0.3in"><ui><textEdit/></ui><value><text maxChars="40"/></value><caption reserve="1.2in"><value><text>Full name</text></value></caption><validate nullTest="error"/></field>
<field name="age" w="2in" h="0.3in"><ui><numericEdit/></ui><caption><value><text>Age</text></value></caption></field>
<field name="dob" w="2.5in" h="0.3in"><ui><dateTimeEdit/></ui><caption><value><text>Date of birth</text></value></caption></field>
<field name="notes" w="5in" h="0.8in"><ui><textEdit multiLine="1"/></ui><caption placement="top"><value><text>Notes</text></value></caption></field>
<field name="agree" w="0.2in" h="0.2in"><ui><checkButton/></ui><items><text>Y</text><text>N</text></items><caption placement="right"><value><text>I agree</text></value></caption></field>
<exclGroup name="plan" layout="tb"><field name="basic" w="1.5in" h="0.25in"><ui><checkButton shape="round"/></ui><items><text>basic</text></items><caption><value><text>Basic plan</text></value></caption></field>
<field name="pro" w="1.5in" h="0.25in"><ui><checkButton shape="round"/></ui><items><text>pro</text></items><caption><value><text>Pro plan</text></value></caption></field></exclGroup>
<field name="country" w="3in" h="0.3in"><ui><choiceList/></ui><items><text>Canada</text><text>United States</text></items><items save="1"><text>CA</text><text>US</text></items><caption><value><text>Country</text></value></caption></field>
<subform name="address" layout="position" w="7.5in" h="0.9in">
<field name="street" x="0" y="0" w="4in" h="0.3in"><ui><textEdit/></ui><caption><value><text>Street</text></value></caption></field>
<field name="town" x="0" y="0.4in" w="3in" h="0.3in"><ui><textEdit/></ui><bind match="dataRef" ref="$.city"/><caption><value><text>City</text></value></caption></field></subform>
<field name="submit" w="1in" h="0.3in"><ui><button/></ui><caption><value><text>Submit</text></value></caption><event activity="click"><script contentType="application/x-formcalc">$host.messageBox("x")</script></event></field>
</subform></template>'''
DYN_DATA = f'<xfa:datasets {X}><xfa:data><form1><full_name>Ada Dynamic</full_name><age>36</age><dob>1990-12-10</dob><notes>line one</notes><agree>Y</agree><plan>pro</plan><country>US</country><address><street>1 Main St</street><city>Guelph</city></address></form1></xfa:data></xfa:datasets>'

LAUGHS = '<?xml version="1.0"?><!DOCTYPE lolz [<!ENTITY lol "lol"><!ENTITY lol2 "&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;"><!ENTITY lol3 "&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;"><!ENTITY lol4 "&lol3;&lol3;&lol3;&lol3;&lol3;&lol3;&lol3;&lol3;&lol3;&lol3;"><!ENTITY lol5 "&lol4;&lol4;&lol4;&lol4;&lol4;&lol4;&lol4;&lol4;&lol4;&lol4;"><!ENTITY lol6 "&lol5;&lol5;&lol5;&lol5;&lol5;&lol5;&lol5;&lol5;&lol5;&lol5;"><!ENTITY lol7 "&lol6;&lol6;&lol6;&lol6;&lol6;&lol6;&lol6;&lol6;&lol6;&lol6;"><!ENTITY lol8 "&lol7;&lol7;&lol7;&lol7;&lol7;&lol7;&lol7;&lol7;&lol7;&lol7;"><!ENTITY lol9 "&lol8;&lol8;&lol8;&lol8;&lol8;&lol8;&lol8;&lol8;&lol8;&lol8;">]>' \
    f'<xfa:datasets {X}><xfa:data><form1><full_name>&lol9;</full_name></form1></xfa:data></xfa:datasets>'
XXE = f'<?xml version="1.0"?><!DOCTYPE d [<!ENTITY xxe SYSTEM "file:///etc/passwd">]><xfa:datasets {X}><xfa:data><form1><full_name>&xxe;</full_name></form1></xfa:data></xfa:datasets>'


def page(lines):
    b = io.BytesIO(); c = canvas.Canvas(b); c.setFont("Helvetica", 12)
    for i, t in enumerate(lines): c.drawString(72, 720 - 20 * i, t)
    c.showPage(); c.save(); return b.getvalue()


def hybrid_base():
    data = page(["Hybrid XFA fixture", "Full name / Agree / Country"])
    data = create_fields(data, [{"name": "full_name", "type": "text", "page": 1, "rect": [72, 600, 300, 620]},
                                {"name": "agree", "type": "checkbox", "page": 1, "rect": [72, 570, 86, 584]},
                                {"name": "country", "type": "dropdown", "page": 1, "rect": [72, 530, 220, 550], "options": ["Canada", "USA"]}])
    pdf = pikepdf.open(io.BytesIO(data)); acro = pdf.Root.AcroForm
    parent = pdf.make_indirect(Dictionary(T=String("form1[0]"), Kids=Array()))
    for f in list(acro.Fields):
        f.T = String(str(f.T) + "[0]"); f.Parent = parent; parent.Kids.append(f)
    acro.Fields = Array([parent]); return pdf


def put_array(pdf, packets):
    arr = Array()
    for n, b in packets: arr.append(String(n)); arr.append(pdf.make_stream(b.encode() if isinstance(b, str) else b))
    pdf.Root.AcroForm.XFA = arr


def save(pdf, name): pdf.save(str(D / name)); print("wrote", name)


def dyn_shell(lines=("Please wait... this document needs an XFA viewer.",)):
    pdf = pikepdf.open(io.BytesIO(page(list(lines))))
    pdf.Root.AcroForm = pdf.make_indirect(Dictionary(Fields=Array())); pdf.Root.NeedsRendering = True; return pdf


if __name__ == "__main__":
    # hybrid as ONE XDP stream
    pdf = hybrid_base()
    pdf.Root.AcroForm.XFA = pdf.make_stream(PRE + HYB_TPL.replace("SCRIPT", "").encode() + HYB_DATA.encode() + POST)
    save(pdf, "xfa-hybrid.pdf")
    # hybrid as packet ARRAY
    pdf = hybrid_base()
    put_array(pdf, [("preamble", PRE.decode()), ("template", HYB_TPL.replace("SCRIPT", "")), ("datasets", HYB_DATA), ("postamble", POST.decode())])
    save(pdf, "xfa-array.pdf")
    # hybrid with scripts (never executed)
    pdf = hybrid_base()
    put_array(pdf, [("preamble", PRE.decode()), ("template", HYB_TPL.replace("SCRIPT", SCRIPT)), ("datasets", HYB_DATA), ("postamble", POST.decode())])
    save(pdf, "xfa-script.pdf")
    # dynamic: XFA only, NeedsRendering
    pdf = dyn_shell(); put_array(pdf, [("preamble", PRE.decode()), ("template", DYN_TPL), ("datasets", DYN_DATA), ("postamble", POST.decode())])
    save(pdf, "xfa-dynamic.pdf")
    # dynamic with nothing renderable (only a button)
    pdf = dyn_shell(); put_array(pdf, [("template", f'<template {T}><subform name="f"><field name="b"><ui><button/></ui></field></subform></template>')])
    save(pdf, "xfa-dynamic-unrenderable.pdf")
    # malicious datasets
    pdf = dyn_shell(); put_array(pdf, [("template", DYN_TPL), ("datasets", LAUGHS)]); save(pdf, "xfa-billion-laughs.pdf")
    pdf = dyn_shell(); put_array(pdf, [("template", DYN_TPL), ("datasets", XXE)]); save(pdf, "xfa-xxe.pdf")


# ---------- regression fixtures reproducing bugs found on real government forms (synthetic, original) ----------
USCIS_TPL = f"""<template {T}><subform name="form1" layout="tb" locale="en_US">
<pageSet><pageArea name="Page1"><contentArea x="0.25in" y="0.25in" w="8in" h="10.5in"/><medium stock="letter" short="8.5in" long="11in"/></pageArea></pageSet>
<subform name="Intro" layout="position" w="8in" h="1in">
 <field name="Intro_Name" x="0.5in" y="0.2in" w="3in" h="0.3in"><ui><textEdit/></ui><caption><value><text>Name</text></value></caption></field></subform>
<subform layout="position" w="8in" h="3in">
 <field name="FamilyName" x="0.5in" y="0.1in" w="3in" h="0.3in"><ui><textEdit/></ui></field>
 <field name="FamilyName" x="4in" y="0.1in" w="3in" h="0.3in"><ui><textEdit/></ui></field>
 <area x="0.5in" y="0.6in"><field name="ANumber" w="2in" h="0.3in"><ui><textEdit><comb numberOfCells="9"/></textEdit></ui><value><text maxChars="9"/></value></field></area>
 <exclGroup name="Gender" x="0.5in" y="1.2in"><field name="M" w="0.2in" h="0.2in"><ui><checkButton shape="round"/></ui><items><text>M</text></items></field>
  <field name="F" x="1in" w="0.2in" h="0.2in"><ui><checkButton shape="round"/></ui><items><text>F</text></items></field></exclGroup>
 <event activity="initialize"><script contentType="application/x-javascript">this.rawValue = 1;</script></event></subform>
<subform name="Section9.1" layout="position" w="8in" h="1in">
 <field name="Notes" x="0.5in" y="0.1in" w="6in" h="0.6in"><ui><textEdit multiLine="1"/></ui><value><exData contentType="text/html"/></value></field></subform>
</subform></template>"""
USCIS_DATA = f"""<xfa:datasets {X}><xfa:data><form1><Intro><Intro_Name>Old Intro</Intro_Name></Intro><FamilyName>First</FamilyName><FamilyName>Second</FamilyName><ANumber>123456789</ANumber><Gender>M</Gender>
<Section9.1><Notes xfa:contentType="text/html"><body xmlns="http://www.w3.org/1999/xhtml"><p>Rich line one<br/></p><p>Rich line two</p></body></Notes></Section9.1></form1></xfa:data></xfa:datasets>"""
USCIS_FIELDS = [  # (AcroForm SOM name, spec)
    ("form1[0].Intro[0].Intro_Name[0]", {"type": "text", "rect": [72, 700, 300, 720]}),
    ("form1[0].#subform[1].FamilyName[0]", {"type": "text", "rect": [72, 650, 280, 670]}),
    ("form1[0].#subform[1].FamilyName[1]", {"type": "text", "rect": [300, 650, 500, 670]}),
    ("form1[0].#subform[1].#area[0].ANumber[0]", {"type": "text", "rect": [72, 610, 220, 630], "max_length": 9}),
    ("form1[0].#subform[1].Gender[0]", {"type": "radio", "options": ["1", "2"], "rects": [[72, 570, 86, 584], [140, 570, 154, 584]]}),
    ("form1[0].Section9\\.1[0].Notes[0]", {"type": "multiline", "rect": [72, 480, 500, 540]}),
]


def _segs(som):
    import re as _re
    return _re.split(r"(?<!\\)\.", som)


def designer_acroform(data, fields):
    """Create widgets with temp names, then nest them into the partial-name tree Designer writes (form1[0] → #subform[1] → X[0])."""
    specs = [{"name": f"tmp{i}", "page": 1, **spec} for i, (_, spec) in enumerate(fields)]
    pdf = pikepdf.open(io.BytesIO(create_fields(data, specs))); acro = pdf.Root.AcroForm
    flat = {str(f.T): f for f in acro.Fields}; roots = Array(); nodes = {}
    for i, (som, _) in enumerate(fields):
        segs = _segs(som); parent = None; path = ""
        for seg in segs[:-1]:
            path = f"{path}.{seg}" if path else seg
            if path not in nodes:
                nd = pdf.make_indirect(Dictionary(T=String(seg), Kids=Array()))
                if parent is None: roots.append(nd)
                else: nd.Parent = parent; parent.Kids.append(nd)
                nodes[path] = nd
            parent = nodes[path]
        leaf = flat[f"tmp{i}"]; leaf.T = String(segs[-1]); leaf.Parent = parent; parent.Kids.append(leaf)
    acro.Fields = roots; return pdf


def uscis_style():
    """Reproduces: packets named 'xdp:xdp' / '</xdp:xdp>', unnamed-subform + area SOM indexing, same-named siblings,
    '.' inside names, XHTML rich-text data, comb MaxLen, radio on-states 1/2 vs XFA values M/F, a 'form' state packet,
    Reader Extensions (/Perms /UR3) and AES encryption with an empty user password."""
    pdf = designer_acroform(page(["USCIS-style hybrid fixture (synthetic)"]), USCIS_FIELDS)
    x = Array()
    for n, b in (("xdp:xdp", '<?xml version="1.0" encoding="UTF-8"?>\n<xdp:xdp xmlns:xdp="http://ns.adobe.com/xdp/" timeStamp="2026-01-01T00:00:00Z">'),
                 ("template", USCIS_TPL), ("datasets", USCIS_DATA),
                 ("form", '<form checksum="AAAA" xmlns="http://www.xfa.org/schema/xfa-form/2.8/"><subform name="form1"/></form>'),
                 ("</xdp:xdp>", "</xdp:xdp>")):
        x.append(String(n)); x.append(pdf.make_stream(b.encode()))
    pdf.Root.AcroForm.XFA = x
    ur = Dictionary(Type=Name.Sig, Filter=Name("/Adobe.PPKLite"), SubFilter=Name("/adbe.pkcs7.detached"),
                    Contents=pikepdf.String(b"\x00" * 64), Reference=Array([Dictionary(TransformMethod=Name.UR3)]))
    pdf.Root.Perms = Dictionary(UR3=pdf.make_indirect(ur))
    pdf.save(str(D / "xfa-uscis-style.pdf"), encryption=pikepdf.Encryption(owner="owner-secret", user="", R=4, aes=True))
    print("wrote xfa-uscis-style.pdf")


LONG = " ".join(["Read every instruction carefully before completing this application form."] * 8)
LAYOUT_TPL = f"""<template {T}><subform name="app" layout="tb">
<pageSet><pageArea name="Legal"><contentArea x="0.5in" y="1in" w="7.5in" h="12.5in"/><medium stock="legal" short="8.5in" long="14in"/>
 <draw name="hdr" x="0.5in" y="0.4in" w="6in" h="0.3in"><value><text>MASTER HEADER TEXT</text></value></draw></pageArea></pageSet>
<draw name="instr" w="7in" h="0.9in"><value><text>{LONG}</text></value></draw>
<subform name="row" layout="lr-tb" w="7.5in"><occur min="1" max="-1" initial="2"/>
 <field name="item" w="3in" h="0.3in"><ui><textEdit/></ui><caption><value><text>Item</text></value></caption></field>
 <field name="qty" w="2in" h="0.3in"><ui><numericEdit/></ui><caption><value><text>Qty</text></value></caption></field>
 <field name="kind" w="2in" h="0.3in"><ui><choiceList/></ui><items><text>Apple</text><text>Pear</text></items><items save="1"><text>A</text><text>P</text></items></field>
</subform></subform></template>"""
LAYOUT_DATA = f"""<xfa:datasets {X}><xfa:data><app><row><item>Alpha</item><qty>1</qty><kind>A</kind></row><row><item>Beta</item><qty>2</qty><kind>P</kind></row>
<row><item>Gamma</item><qty>3</qty><kind>P</kind></row></app></xfa:data></xfa:datasets>"""


def dynamic_layout():
    """Reproduces: pageArea/contentArea page size (legal), master-page draw text, long draw text wrapping,
    occur repeats driven by data (3 instances > initial 2), lr-tb flow, dropdown save values vs labels."""
    pdf = dyn_shell(); put_array(pdf, [("preamble", PRE.decode()), ("template", LAYOUT_TPL), ("datasets", LAYOUT_DATA), ("postamble", POST.decode())])
    save(pdf, "xfa-dynamic-layout.pdf")


if __name__ == "__main__":
    uscis_style(); dynamic_layout()
