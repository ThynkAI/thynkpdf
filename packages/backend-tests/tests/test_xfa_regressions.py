"""Regressions for bugs found running real government XFA forms (USCIS, OPM SF-86, Grants.gov SF-424), reproduced with
small synthetic fixtures, plus the frontend review items on PR #24. The optional last test runs every PDF in
/workspace/xfa-real (not redistributable, never committed) when that folder exists."""
import io, glob, os, pytest
import pikepdf
from pypdf import PdfReader
from conftest import upload, pdftotext

def up(c, h, name): r = upload(c, h, name); assert r.status_code in (200, 201), r.text; return r.json()["document_id"]
def dl(c, h, doc): return c.get(f"/documents/{doc}/download", headers=h).content
def data_map(c, h, doc): return {f["name"]: f["value"] for f in c.get(f"/pdf/{doc}/forms/xfa", headers=h).json()["fields"]}
def acro_map(c, h, doc): return {f["name"]: f["value"] for f in c.get(f"/pdf/{doc}/forms", headers=h).json()["fields"]}
U = "xfa-uscis-style.pdf"

def test_wrapper_packets_named_xdp_are_skipped(client, orgA):
    # bug: entries named 'xdp:xdp' / '</xdp:xdp>' were parsed as packets → 422 XFA_MALFORMED on every USCIS form
    doc = up(client, orgA, U)
    x = client.get(f"/pdf/{doc}/forms", headers=orgA).json()["xfa"]
    assert x["kind"] == "hybrid" and x["packets"] == ["template", "datasets", "form"] and x["xml_safe"] is True
    assert client.get(f"/pdf/{doc}/forms/xfa", headers=orgA).status_code == 200

def test_som_indexing_matches_designer_acroform_names(client, orgA):
    # bug: unnamed subforms/areas, same-named siblings and '.' in names broke XFA↔AcroForm mapping (0 synced fields)
    s = client.get(f"/pdf/{up(client, orgA, U)}/forms/xfa/schema", headers=orgA).json()
    got = {f["som"]: (f["name"], f["acroform_field"]) for f in s["fields"]}
    assert got == {
        "form1[0].Intro[0].Intro_Name[0]": ("form1.Intro.Intro_Name", "form1[0].Intro[0].Intro_Name[0]"),
        "form1[0].#subform[1].FamilyName[0]": ("form1.FamilyName", "form1[0].#subform[1].FamilyName[0]"),
        "form1[0].#subform[1].FamilyName[1]": ("form1.FamilyName[1]", "form1[0].#subform[1].FamilyName[1]"),
        "form1[0].#subform[1].#area[0].ANumber[0]": ("form1.ANumber", "form1[0].#subform[1].#area[0].ANumber[0]"),
        "form1[0].#subform[1].Gender[0]": ("form1.Gender", "form1[0].#subform[1].Gender[0]"),
        "form1[0].Section9\\.1[0].Notes[0]": ("form1.Section9\\.1.Notes", "form1[0].Section9\\.1[0].Notes[0]")}
    by = {f["som"]: f for f in s["fields"]}
    assert by["form1[0].#subform[1].#area[0].ANumber[0]"]["max_chars"] == 9
    assert by["form1[0].Intro[0].Intro_Name[0]"]["section"] == "form1[0].Intro[0]" and by["form1[0].Intro[0].Intro_Name[0]"]["section_name"] == "Intro"

def test_hybrid_round_trip_real_style(client, orgA):
    doc = up(client, orgA, U)
    r = client.post("/pdf/forms/xfa/fill", headers=orgA, json={"document_id": doc, "expected_version": 1, "values": {
        "form1.FamilyName[1]": "Zed", "form1[0].#subform[1].#area[0].ANumber[0]": "A12345678", "form1.Gender": "F",
        "form1.Section9\\.1.Notes": "plain now"}})
    assert r.status_code == 200, r.text; rep = r.json()["report"]
    assert len(rep["acroform_updated"]) == 4 and len(rep["datasets_updated"]) == 4
    assert rep["usage_rights_removed"] is True and rep["form_state_packet_removed"] is True
    d = data_map(client, orgA, doc)
    assert d["form1.FamilyName"] == "First" and d["form1.FamilyName[1]"] == "Zed" and d["form1.ANumber"] == "A12345678"
    assert d["form1.Gender"] == "F" and d["form1.Section9\\.1.Notes"] == "plain now"
    a = acro_map(client, orgA, doc)
    assert a["form1[0].#subform[1].FamilyName[1]"] == "Zed" and a["form1[0].#subform[1].Gender[0]"] == "2"  # XFA 'F' → widget state '2'
    raw = dl(client, orgA, doc)
    with pikepdf.open(io.BytesIO(raw)) as pdf:  # opens without a password; Reader Extensions removed
        assert "/Perms" not in pdf.Root and [str(x) for x in pdf.Root.AcroForm.XFA[::2]] == ["xdp:xdp", "template", "datasets", "</xdp:xdp>"]
    assert PdfReader(io.BytesIO(raw)).get_fields()["form1[0].#subform[1].FamilyName[1]"]["/V"] == "Zed"

def test_rich_text_data_is_plain_text(client, orgA):
    assert data_map(client, orgA, up(client, orgA, U))["form1.Section9\\.1.Notes"] == "Rich line one\nRich line two"

def test_acroform_fill_syncs_through_som(client, orgA):
    doc = up(client, orgA, U)
    r = client.post("/pdf/forms/fill", headers=orgA, json={"document_id": doc, "expected_version": 1,
                    "values": {"form1[0].#subform[1].FamilyName[0]": "ViaAcro", "form1[0].#subform[1].Gender[0]": "2"}})
    assert r.status_code == 200, r.text
    d = data_map(client, orgA, doc); assert d["form1.FamilyName"] == "ViaAcro" and d["form1.Gender"] == "F"

def test_dynamic_layout_occur_pagearea_lrtb_labels(client, orgA):
    doc = up(client, orgA, "xfa-dynamic-layout.pdf")
    s = client.get(f"/pdf/{doc}/forms/xfa/schema", headers=orgA).json(); by = {f["som"]: f for f in s["fields"]}
    assert [f["som"] for f in s["fields"] if f["som"].endswith("item[0]")] == ["app[0].row[0].item[0]", "app[0].row[1].item[0]", "app[0].row[2].item[0]"]
    r2 = by["app[0].row[2].item[0]"]
    assert r2["name"] == "app.row[2].item" and r2["value"] == "Gamma" and r2["occur"] == {"min": 1, "max": -1, "initial": 2} and r2["instance"] == 2
    assert r2["section"] == "app[0].row[2]" and r2["section_name"] == "row"
    assert by["app[0].row[0].qty[0]"]["layout"]["y"] == by["app[0].row[0].item[0]"]["layout"]["y"]  # lr-tb: same row
    assert by["app[0].row[0].qty[0]"]["layout"]["x"] > by["app[0].row[0].item[0]"]["layout"]["x"]
    r = client.post("/pdf/forms/xfa/convert", headers=orgA, json={"document_id": doc, "expected_version": 1}); assert r.status_code == 200, r.text
    raw = dl(client, orgA, doc)
    with pikepdf.open(io.BytesIO(raw)) as pdf:
        assert [float(v) for v in pdf.pages[0].mediabox] == [0, 0, 612, 1008]  # legal, from <medium>
        kind = next(f for f in pdf.Root.AcroForm.Fields if str(f.T) == "app_row_2__kind")
        assert [[str(x) for x in o] for o in kind.Opt] == [["A", "Apple"], ["P", "Pear"]]
    t = pdftotext(raw)
    assert "MASTER HEADER TEXT" in t and "Gamma" in t and "Read every instruction" in t
    a = acro_map(client, orgA, doc); assert a["app_row_2__item"] == "Gamma" and a["app_row_2__kind"] == "P"
    # no line of the long instruction text runs past the content width
    assert max(len(l) for l in t.splitlines()) < 200

# ---- frontend review items on PR #24 ----
def test_stale_write_on_converted_doc_is_409_not_422(client, orgA):
    doc = up(client, orgA, "xfa-hybrid.pdf")
    assert client.post("/pdf/forms/xfa/convert", headers=orgA, json={"document_id": doc, "expected_version": 1}).status_code == 200
    for path, body in (("/pdf/forms/xfa/fill", {"values": {"form1.full_name": "x"}}), ("/pdf/forms/xfa/convert", {}),
                       ("/pdf/forms/xfa/data", {"xml": "<form1/>"}), ("/pdf/forms/fill", {"values": {"x": "y"}}),
                       ("/pdf/forms/flatten", {"confirm": True})):
        r = client.post(path, headers=orgA, json={"document_id": doc, "expected_version": 1, **body})
        assert r.status_code == 409 and r.json()["error"]["code"] == "VERSION_CONFLICT", (path, r.text)
    r = client.post("/pdf/forms/xfa/fill", headers=orgA, json={"document_id": doc, "expected_version": 2, "values": {"form1.full_name": "x"}})
    assert r.status_code == 422 and r.json()["error"]["code"] == "XFA_NOT_PRESENT"

def test_import_merge_default_and_replace(client, orgA):
    doc = up(client, orgA, "xfa-array.pdf")
    r = client.post("/pdf/forms/xfa/data", headers=orgA, json={"document_id": doc, "expected_version": 1, "xml": "<form1><full_name>Only Name</full_name></form1>"})
    assert r.status_code == 200 and r.json()["report"]["mode"] == "merge"
    assert data_map(client, orgA, doc) == {"form1.full_name": "Only Name", "form1.agree": "0", "form1.country": "Canada"}
    r = client.post("/pdf/forms/xfa/data", headers=orgA, json={"document_id": doc, "expected_version": 2, "mode": "replace",
                    "xml": "<form1><full_name>Replaced</full_name></form1>"})
    assert r.status_code == 200 and r.json()["report"]["mode"] == "replace"
    assert data_map(client, orgA, doc) == {"form1.full_name": "Replaced"}
    assert client.post("/pdf/forms/xfa/data", headers=orgA, json={"document_id": doc, "expected_version": 3, "mode": "wipe", "xml": "<a/>"}).status_code == 422

def test_openapi_and_capabilities(client, orgA):
    spec = client.get("/openapi.json").json(); sch = spec["components"]["schemas"]
    for n in ("XfaInfo", "XfaSchemaField", "XfaSchemaOut", "XfaDataOut", "XfaFillReport", "XfaImportReport", "XfaConvertReport", "XfaOccur", "XfaCapabilities"):
        assert n in sch, n
    assert {"section", "section_name", "section_caption", "occur", "instance", "acroform_field"} <= set(sch["XfaSchemaField"]["properties"])
    assert "mode" in sch["XfaImportIn"]["properties"]
    ref = spec["paths"]["/pdf/forms/xfa/fill"]["post"]["responses"]["200"]["content"]["application/json"]["schema"]["$ref"]
    assert sch[ref.split("/")[-1]]["properties"]["report"]["$ref"].endswith("XfaFillReport")
    c = client.get(f"/pdf/{up(client, orgA, 'xfa-dynamic.pdf')}/capabilities", headers=orgA).json()["xfa"]
    assert c == {"present": True, "kind": "dynamic", "read": True, "schema": True, "fill": True, "xml_import_export": True,
                 "convert": True, "flatten": True, "has_scripts": True, "error": None}
    c = client.get(f"/pdf/{up(client, orgA, 'xfa-xxe.pdf')}/capabilities", headers=orgA).json()["xfa"]
    assert c["present"] and not c["fill"] and c["error"] == "XFA_UNSAFE_XML"
    assert client.get(f"/pdf/{up(client, orgA, 'simple-1page.pdf')}/capabilities", headers=orgA).json()["xfa"]["present"] is False

REAL = sorted(glob.glob("/workspace/xfa-real/*.pdf"))

@pytest.mark.skipif(not REAL, reason="/workspace/xfa-real not present (real forms are not redistributable)")
@pytest.mark.parametrize("path", REAL, ids=[os.path.basename(p) for p in REAL])
def test_real_government_forms(path):
    """Engine-level: detect, read, schema, sync mapping, fill round trip, XML export/merge import, convert, flatten."""
    import thynkpdf_engine as eng
    from thynkpdf_engine import xfa
    d = open(path, "rb").read(); info = xfa.detect(d); assert info["present"] and info["xml_safe"]
    rd = xfa.read_data(d); sc = xfa.template_schema(d); assert sc["fields"]
    if info["kind"] == "hybrid":
        acro = {f["name"] for f in eng.list_fields(d) if "#pageSet" not in f["name"]}
        assert acro <= {f["som"] for f in sc["fields"]}  # every non-master-page widget is found in the template
    pick = {}
    for f in sc["fields"]:
        if f["name"] and not f["read_only"] and f["type"] == "text" and len(pick) < 3:
            pick[f["name"]] = "Zq"[: f["max_chars"] or 2]
    out, rep = xfa.fill(d, pick); m = {x["name"]: x["value"] for x in xfa.read_data(out)["fields"]}
    assert all(m[k] == v for k, v in pick.items())
    if info["kind"] == "hybrid":
        a = {f["name"]: f["value"] for f in eng.list_fields(out)}
        assert all(a[rd_f] == pick[k] for k in pick for rd_f in [next(x["acroform_field"] for x in xfa.read_data(out)["fields"] if x["name"] == k)] if rd_f)
    out2, _ = xfa.import_xml(out, b"<x/>" if False else xfa.export_xml(out)); assert xfa.read_data(out2)["fields"]
    conv, crep = xfa.convert_to_acroform(out); assert eng.list_fields(conv) and "/XFA" not in pikepdf.open(io.BytesIO(conv)).Root.AcroForm
    eng.flatten(conv)
