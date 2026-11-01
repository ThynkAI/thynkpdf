"""XFA: detection, read, fill (hybrid + dynamic), template schema, XML export/import, conversion, flatten,
version conflicts, tenant isolation and hostile XML. Fixtures come from make_xfa_fixtures.py (original)."""
import io, subprocess
import pikepdf
from pypdf import PdfReader
from conftest import upload, pdftotext, FIX

def up(c, h, name): r = upload(c, h, name); assert r.status_code in (200, 201), r.text; return r.json()["document_id"]
def dl(c, h, doc): return c.get(f"/documents/{doc}/download", headers=h).content
def data_map(c, h, doc): return {f["name"]: f["value"] for f in c.get(f"/pdf/{doc}/forms/xfa", headers=h).json()["fields"]}
def acro_map(c, h, doc): return {f["name"]: f["value"] for f in c.get(f"/pdf/{doc}/forms", headers=h).json()["fields"]}

def test_detection_all_kinds(client, orgA):
    exp = {"xfa-hybrid.pdf": ("hybrid", "stream", False), "xfa-array.pdf": ("hybrid", "array", False),
           "xfa-script.pdf": ("hybrid", "array", True), "xfa-dynamic.pdf": ("dynamic", "array", True)}
    for name, (kind, form, scripts) in exp.items():
        x = client.get(f"/pdf/{up(client, orgA, name)}/forms", headers=orgA).json()["xfa"]
        assert (x["present"], x["kind"], x["form"], x["has_scripts"]) == (True, kind, form, scripts), (name, x)
        assert "template" in x["packets"] and "datasets" in x["packets"]
    x = client.get(f"/pdf/{up(client, orgA, 'xfa-dynamic.pdf')}/forms", headers=orgA).json()["xfa"]
    assert x["needs_rendering"] is True and x["acroform_widgets"] == 0
    x = client.get(f"/pdf/{up(client, orgA, 'simple-1page.pdf')}/forms", headers=orgA).json()["xfa"]
    assert x == {**x, "present": False, "kind": "none", "packets": []}
    assert client.get(f"/pdf/{up(client, orgA, 'simple-1page.pdf')}/forms/xfa", headers=orgA).json()["error"]["code"] == "XFA_NOT_PRESENT"

def test_read_datasets(client, orgA):
    for n in ("xfa-hybrid.pdf", "xfa-array.pdf"):
        r = client.get(f"/pdf/{up(client, orgA, n)}/forms/xfa", headers=orgA).json()
        assert {f["name"]: (f["value"], f["acroform_field"]) for f in r["fields"]} == {
            "form1.full_name": ("Jane Original", "form1[0].full_name[0]"), "form1.agree": ("0", "form1[0].agree[0]"),
            "form1.country": ("Canada", "form1[0].country[0]")}
    m = data_map(client, orgA, up(client, orgA, "xfa-dynamic.pdf"))
    assert m["form1.address.city"] == "Guelph" and m["form1.plan"] == "pro" and len(m) == 9

def test_hybrid_fill_round_trip_both_models(client, orgA):
    for n in ("xfa-hybrid.pdf", "xfa-array.pdf"):
        doc = up(client, orgA, n)
        r = client.post("/pdf/forms/xfa/fill", headers=orgA, json={"document_id": doc, "expected_version": 1,
                        "values": {"form1.full_name": "Zoë Round-Trip", "form1[0].agree[0]": True, "form1.country": "USA"}})
        assert r.status_code == 200, r.text; assert r.json()["version"] == 2
        assert data_map(client, orgA, doc) == {"form1.full_name": "Zoë Round-Trip", "form1.agree": "1", "form1.country": "USA"}
        assert acro_map(client, orgA, doc) == {"form1[0].full_name[0]": "Zoë Round-Trip", "form1[0].agree[0]": True, "form1[0].country[0]": "USA"}
        # independent reader (pypdf) sees the AcroForm value and the raw datasets XML
        raw = dl(client, orgA, doc); rd = PdfReader(io.BytesIO(raw))
        assert rd.get_fields()["form1[0].full_name[0]"]["/V"] == "Zoë Round-Trip"
        with pikepdf.open(io.BytesIO(raw)) as pdf:
            x = pdf.Root.AcroForm.XFA
            blob = x.read_bytes() if isinstance(x, pikepdf.Stream) else b"".join(x[i].read_bytes() for i in range(1, len(x), 2))
        assert "Zoë Round-Trip".encode() in blob and b"<country>USA</country>" in blob
        assert client.get(f"/pdf/{doc}/forms?version=2", headers=orgA).json()["xfa"]["form"] == ("stream" if n == "xfa-hybrid.pdf" else "array")

def test_acroform_fill_syncs_datasets_on_hybrid(client, orgA):
    doc = up(client, orgA, "xfa-hybrid.pdf")
    r = client.post("/pdf/forms/fill", headers=orgA, json={"document_id": doc, "expected_version": 1, "values": {"form1[0].full_name[0]": "Via AcroForm"}})
    assert r.status_code == 200 and r.json()["report"]["xfa_datasets_synced"] is True
    assert data_map(client, orgA, doc)["form1.full_name"] == "Via AcroForm"

def test_dynamic_fill_datasets_only_and_creates_nodes(client, orgA):
    doc = up(client, orgA, "xfa-dynamic.pdf")
    r = client.post("/pdf/forms/xfa/fill", headers=orgA, json={"document_id": doc, "expected_version": 1,
                    "values": {"form1.full_name": "New Name", "form1.address.city": "Waterloo"}})
    assert r.status_code == 200, r.text; assert r.json()["report"]["acroform_updated"] == []
    m = data_map(client, orgA, doc); assert m["form1.full_name"] == "New Name" and m["form1.address.city"] == "Waterloo"
    assert client.get(f"/pdf/{doc}/forms", headers=orgA).json()["fields"] == []
    r = client.post("/pdf/forms/xfa/fill", headers=orgA, json={"document_id": doc, "expected_version": 2, "values": {"form1.nope": "x"}})
    assert r.status_code == 422 and r.json()["error"]["code"] == "FORM_FIELD_NOT_FOUND"

def test_template_schema(client, orgA):
    r = client.get(f"/pdf/{up(client, orgA, 'xfa-dynamic.pdf')}/forms/xfa/schema", headers=orgA); assert r.status_code == 200, r.text
    j = r.json(); by = {f["som"]: f for f in j["fields"]}
    assert {k: by[k]["type"] for k in by} == {"form1[0].full_name[0]": "text", "form1[0].age[0]": "numeric", "form1[0].dob[0]": "date", "form1[0].notes[0]": "text",
        "form1[0].agree[0]": "checkbox", "form1[0].plan[0]": "radio", "form1[0].country[0]": "choice", "form1[0].address[0].street[0]": "text",
        "form1[0].address[0].town[0]": "text", "form1[0].submit[0]": "button"}
    assert by["form1[0].full_name[0]"]["required"] and by["form1[0].full_name[0]"]["max_chars"] == 40 and by["form1[0].full_name[0]"]["caption"] == "Full name"
    assert by["form1[0].notes[0]"]["multiline"] and by["form1[0].agree[0]"]["on_value"] == "Y"
    assert by["form1[0].plan[0]"]["options"] == ["basic", "pro"] and by["form1[0].plan[0]"]["option_captions"] == ["Basic plan", "Pro plan"] and by["form1[0].plan[0]"]["value"] == "pro"
    assert by["form1[0].country[0]"]["options"] == ["CA", "US"] and by["form1[0].country[0]"]["option_captions"] == ["Canada", "United States"]
    assert by["form1[0].address[0].town[0]"]["name"] == "form1.address.city" and by["form1[0].address[0].town[0]"]["value"] == "Guelph"  # dataRef binding
    assert by["form1[0].address[0].town[0]"]["layout"]["y"] > by["form1[0].address[0].street[0]"]["layout"]["y"]
    assert j["scripts_ignored"] == 1 and "scripts_ignored" in j["warnings"]
    hy = client.get(f"/pdf/{up(client, orgA, 'xfa-hybrid.pdf')}/forms/xfa/schema", headers=orgA).json()
    f = {x["som"]: x for x in hy["fields"]}["form1[0].full_name[0]"]["layout"]; assert (f["x"], f["y"], f["w"]) == (72, 72, 216)

def test_xml_export_import(client, orgA):
    doc = up(client, orgA, "xfa-array.pdf")
    r = client.get(f"/pdf/{doc}/forms/xfa/data.xml", headers=orgA)
    assert r.status_code == 200 and r.headers["content-type"].startswith("application/xml") and b"Jane Original" in r.content
    xml = r.content.decode().replace("Jane Original", "Imported Person").replace("<country>Canada</country>", "<country>USA</country>")
    r = client.post("/pdf/forms/xfa/data", headers=orgA, json={"document_id": doc, "expected_version": 1, "xml": xml})
    assert r.status_code == 200, r.text; assert set(r.json()["report"]["acroform_updated"]) >= {"form1[0].full_name[0]", "form1[0].country[0]"}
    assert data_map(client, orgA, doc)["form1.full_name"] == "Imported Person"
    assert acro_map(client, orgA, doc)["form1[0].country[0]"] == "USA"
    # bare record element is accepted too; and export of the new version reflects it
    r = client.post("/pdf/forms/xfa/data", headers=orgA, json={"document_id": doc, "expected_version": 2, "xml": "<form1><full_name>Bare</full_name></form1>"})
    assert r.status_code == 200 and b"Bare" in client.get(f"/pdf/{doc}/forms/xfa/data.xml", headers=orgA).content
    for bad in ('<?xml version="1.0"?><!DOCTYPE d [<!ENTITY x SYSTEM "file:///etc/passwd">]><form1><a>&x;</a></form1>', "<form1><a></form1>"):
        r = client.post("/pdf/forms/xfa/data", headers=orgA, json={"document_id": doc, "expected_version": 3, "xml": bad})
        assert r.status_code == 422 and r.json()["error"]["code"] in ("XFA_UNSAFE_XML", "XFA_MALFORMED")
        assert b"root:" not in r.content

def test_convert_hybrid_strips_xfa(client, orgA):
    doc = up(client, orgA, "xfa-script.pdf")
    r = client.post("/pdf/forms/xfa/convert", headers=orgA, json={"document_id": doc, "expected_version": 1})
    assert r.status_code == 200, r.text; assert r.json()["report"]["mode"] == "stripped_xfa"
    with pikepdf.open(io.BytesIO(dl(client, orgA, doc))) as pdf:
        assert "/XFA" not in pdf.Root.AcroForm and "/NeedsRendering" not in pdf.Root and len(pdf.Root.AcroForm.Fields) == 1
    j = client.get(f"/pdf/{doc}/forms", headers=orgA).json(); assert j["xfa"]["kind"] == "none" and len(j["fields"]) == 3

def test_convert_dynamic_renders_acroform(client, orgA):
    doc = up(client, orgA, "xfa-dynamic.pdf")
    r = client.post("/pdf/forms/xfa/convert", headers=orgA, json={"document_id": doc, "expected_version": 1})
    assert r.status_code == 200, r.text; rep = r.json()["report"]
    assert rep["mode"] == "rendered_from_template" and rep["fields"] == 9 and "button_fields_not_converted" in rep["warnings"]
    j = client.get(f"/pdf/{doc}/forms", headers=orgA).json(); assert j["xfa"]["present"] is False
    by = {f["name"]: f for f in j["fields"]}
    assert by["form1_full_name"]["value"] == "Ada Dynamic" and by["form1_full_name"]["required"] and by["form1_full_name"]["max_length"] == 40
    assert by["form1_notes"]["multiline"] and by["form1_agree"]["value"] is True and by["form1_plan"]["value"] == "pro"
    assert by["form1_country"]["type"] == "dropdown" and by["form1_country"]["value"] == "US" and by["form1_address_city"]["value"] == "Guelph"
    assert all(f["page"] == 1 and len(f["rect"]) == 4 for f in j["fields"])
    raw = dl(client, orgA, doc); txt = pdftotext(raw)
    assert "Membership Application" in txt and "Full name" in txt and "Ada Dynamic" in txt and "Guelph" in txt
    assert set(PdfReader(io.BytesIO(raw)).get_fields()) >= {"form1_full_name", "form1_plan", "form1_country"}
    # converted doc is now a normal AcroForm: fill + flatten work
    assert client.post("/pdf/forms/fill", headers=orgA, json={"document_id": doc, "expected_version": 2, "values": {"form1_age": "41"}}).status_code == 200
    assert acro_map(client, orgA, doc)["form1_age"] == "41"

def test_convert_dynamic_unrenderable_422(client, orgA):
    doc = up(client, orgA, "xfa-dynamic-unrenderable.pdf")
    r = client.post("/pdf/forms/xfa/convert", headers=orgA, json={"document_id": doc, "expected_version": 1})
    assert r.status_code == 422 and r.json()["error"]["code"] == "xfa_dynamic_unsupported" and r.json()["error"]["details"]["unsupported"] == ["button"]
    assert client.get(f"/documents/{doc}", headers=orgA).json()["current_version"] == 1

def test_flatten_hybrid_and_dynamic(client, orgA):
    for n in ("xfa-hybrid.pdf", "xfa-dynamic.pdf"):
        doc = up(client, orgA, n)
        r = client.post("/pdf/forms/flatten", headers=orgA, json={"document_id": doc, "expected_version": 1, "confirm": True})
        assert r.status_code == 200, (n, r.text)
        raw = dl(client, orgA, doc)
        with pikepdf.open(io.BytesIO(raw)) as pdf: assert "/AcroForm" not in pdf.Root and "/NeedsRendering" not in pdf.Root
        if n == "xfa-dynamic.pdf": assert "Ada Dynamic" in pdftotext(raw)

def test_version_conflict(client, orgA):
    doc = up(client, orgA, "xfa-hybrid.pdf")
    ok = client.post("/pdf/forms/xfa/fill", headers=orgA, json={"document_id": doc, "expected_version": 1, "values": {"form1.full_name": "A"}})
    assert ok.status_code == 200
    for path, body in (("/pdf/forms/xfa/fill", {"values": {"form1.full_name": "B"}}), ("/pdf/forms/xfa/convert", {}),
                       ("/pdf/forms/xfa/data", {"xml": "<form1><full_name>C</full_name></form1>"})):
        r = client.post(path, headers=orgA, json={"document_id": doc, "expected_version": 1, **body})
        assert r.status_code == 409 and r.json()["error"]["code"] == "VERSION_CONFLICT" and r.json()["error"]["details"]["current_version"] == 2
    assert data_map(client, orgA, doc)["form1.full_name"] == "A"

def test_tenant_isolation(client, orgA, orgB):
    doc = up(client, orgA, "xfa-hybrid.pdf")
    for path in (f"/pdf/{doc}/forms/xfa", f"/pdf/{doc}/forms/xfa/schema", f"/pdf/{doc}/forms/xfa/data.xml", f"/pdf/{doc}/forms"):
        assert client.get(path, headers=orgB).status_code == 404, path
    for path, body in (("/pdf/forms/xfa/fill", {"values": {"form1.full_name": "evil"}}), ("/pdf/forms/xfa/convert", {}),
                       ("/pdf/forms/xfa/data", {"xml": "<form1><full_name>evil</full_name></form1>"})):
        assert client.post(path, headers=orgB, json={"document_id": doc, "expected_version": 1, **body}).status_code == 404, path
    assert data_map(client, orgA, doc)["form1.full_name"] == "Jane Original"

def test_hostile_xml_rejected_not_expanded(client, orgA):
    for n in ("xfa-billion-laughs.pdf", "xfa-xxe.pdf"):
        doc = up(client, orgA, n)
        x = client.get(f"/pdf/{doc}/forms", headers=orgA).json()["xfa"]; assert x["present"] and x["xml_safe"] is False
        for path in (f"/pdf/{doc}/forms/xfa", f"/pdf/{doc}/forms/xfa/schema", f"/pdf/{doc}/forms/xfa/data.xml"):
            r = client.get(path, headers=orgA); assert r.status_code == 422 and r.json()["error"]["code"] == "XFA_UNSAFE_XML", (n, path, r.text)
            assert b"lollol" not in r.content and b"root:" not in r.content
        for path, body in (("/pdf/forms/xfa/fill", {"values": {"form1.full_name": "x"}}), ("/pdf/forms/xfa/convert", {})):
            assert client.post(path, headers=orgA, json={"document_id": doc, "expected_version": 1, **body}).json()["error"]["code"] == "XFA_UNSAFE_XML"

def test_scripts_reported_never_executed(client, orgA):
    doc = up(client, orgA, "xfa-script.pdf")
    x = client.get(f"/pdf/{doc}/forms", headers=orgA).json()["xfa"]; assert x["has_scripts"] and x["script_count"] == 1
    s = client.get(f"/pdf/{doc}/forms/xfa/schema", headers=orgA).json(); assert s["scripts_ignored"] == 1
    r = client.post("/pdf/forms/xfa/fill", headers=orgA, json={"document_id": doc, "expected_version": 1, "values": {"form1.full_name": "Safe"}})
    assert r.status_code == 200 and data_map(client, orgA, doc)["form1.full_name"] == "Safe"  # initialize script would not change it anyway; nothing evaluated

def test_engine_size_limits():
    import thynkpdf_engine as eng
    from thynkpdf_engine import xfa
    import pytest
    big = b"<a>" + b"<b/>" * (xfa.MAX_NODES + 1) + b"</a>"
    with pytest.raises(eng.EngineError) as e: xfa.safe_parse(big)
    assert e.value.code == "XFA_TOO_LARGE"
    with pytest.raises(eng.EngineError) as e: xfa.safe_parse(b"<a>" + b"x" * (xfa.MAX_PACKET + 1) + b"</a>")
    assert e.value.code == "XFA_TOO_LARGE"
    # compression bomb: 50 MB of zeros flate-compressed into a tiny stream
    import zlib
    pdf = pikepdf.open(FIX / "xfa-dynamic.pdf"); pdf.Root.AcroForm.XFA = pdf.make_stream(zlib.compress(b"<a>" + b" " * 50_000_000 + b"</a>"))
    pdf.Root.AcroForm.XFA.Filter = pikepdf.Name.FlateDecode
    with pytest.raises(eng.EngineError) as e: xfa.detect_pdf(pdf)
    assert e.value.code == "XFA_TOO_LARGE"
