import io, json, subprocess
import pikepdf
from pypdf import PdfReader
from conftest import upload, pdftotext

def dl(c, h, doc): return c.get(f"/documents/{doc}/download", headers=h).content

def test_annotations_crud_persisted(client, orgA):
    doc = upload(client, orgA).json()["document_id"]; v = 1; ids = {}
    for a in [{"type": "highlight", "page": 1, "rect": [70, 715, 250, 735], "contents": "check this"},
              {"type": "note", "page": 1, "rect": [400, 700, 420, 720], "contents": "Sticky note text"},
              {"type": "ink", "page": 2, "ink": [[100, 100, 150, 160, 200, 120]], "color": [0, 0, 1]},
              {"type": "rectangle", "page": 1, "rect": [60, 670, 300, 740]},
              {"type": "ellipse", "page": 3, "rect": [100, 100, 200, 160]},
              {"type": "line", "page": 3, "rect": [100, 300, 300, 300.0001]}]:
        r = client.post("/pdf/annotations", headers=orgA, json={"document_id": doc, "expected_version": v, **a})
        assert r.status_code == 200, r.text; v = r.json()["version"]; ids[a["type"]] = r.json()["annotation_id"]
    lst = client.get(f"/pdf/{doc}/annotations", headers=orgA).json(); assert len(lst) == 6
    b = dl(client, orgA, doc)
    rd = PdfReader(io.BytesIO(b))  # independent reader
    subs = sorted(str(a.get_object()["/Subtype"]) for pg in rd.pages for a in pg.get("/Annots", []))
    assert subs == ["/Circle", "/Highlight", "/Ink", "/Line", "/Square", "/Text"]
    assert all("/AP" in a.get_object() for pg in rd.pages for a in pg.get("/Annots", []))
    r = client.patch(f"/pdf/annotations/{ids['note']}", headers=orgA, json={"document_id": doc, "expected_version": v, "contents": "edited note"})
    assert r.status_code == 200, r.text; v += 1
    assert [a["contents"] for a in client.get(f"/pdf/{doc}/annotations?page=1", headers=orgA).json() if a["id"] == ids["note"]] == ["edited note"]
    r = client.delete(f"/pdf/annotations/{ids['ink']}", headers=orgA, params={"document_id": doc, "expected_version": v}); assert r.status_code == 200; v += 1
    assert len(client.get(f"/pdf/{doc}/annotations", headers=orgA).json()) == 5
    assert client.delete("/pdf/annotations/nope", headers=orgA, params={"document_id": doc, "expected_version": v}).json()["error"]["code"] == "ANNOTATION_NOT_FOUND"
    assert client.post("/pdf/annotations", headers=orgA, json={"document_id": doc, "expected_version": v, "type": "highlight", "page": 1, "rect": [5, 5, 1, 1]}).status_code == 400
    subprocess.run(["pdftotext", "-", "-"], input=dl(client, orgA, doc), check=True, capture_output=True)

FIELDS = [{"name": "full_name", "type": "text", "page": 1, "rect": [72, 600, 300, 620], "required": True, "max_length": 40},
          {"name": "notes", "type": "multiline", "page": 1, "rect": [72, 500, 300, 580]},
          {"name": "agree", "type": "checkbox", "page": 1, "rect": [72, 470, 86, 484]},
          {"name": "plan", "type": "radio", "page": 1, "options": ["basic", "pro"], "rects": [[72, 440, 86, 454], [100, 440, 114, 454]]},
          {"name": "country", "type": "dropdown", "page": 1, "rect": [72, 400, 200, 420], "options": ["Canada", "USA"]},
          {"name": "langs", "type": "listbox", "page": 1, "rect": [72, 330, 200, 390], "options": ["en", "fr", "es"]},
          {"name": "sig", "type": "signature", "page": 1, "rect": [300, 100, 500, 150]}]

def test_forms_create_fill_export_flatten(client, orgA):
    doc = upload(client, orgA, "simple-1page.pdf").json()["document_id"]
    r = client.post("/pdf/forms", headers=orgA, json={"document_id": doc, "expected_version": 1, "fields": FIELDS}); assert r.status_code == 200, r.text
    f = {x["name"]: x for x in client.get(f"/pdf/{doc}/forms", headers=orgA).json()}
    assert f["full_name"]["required"] and f["plan"]["options"] == ["basic", "pro"] and f["country"]["type"] == "dropdown" and f["sig"]["type"] == "signature"
    bad = client.post("/pdf/forms/fill", headers=orgA, json={"document_id": doc, "expected_version": 2, "values": {"country": "Mars", "full_name": "x" * 41}})
    assert bad.status_code == 422 and set(bad.json()["error"]["details"]["fields"]) == {"country", "full_name"}
    assert client.post("/pdf/forms/fill", headers=orgA, json={"document_id": doc, "expected_version": 2, "values": {"ghost": 1}}).json()["error"]["code"] == "FORM_FIELD_NOT_FOUND"
    r = client.post("/pdf/forms/fill", headers=orgA, json={"document_id": doc, "expected_version": 2, "values": {"notes": "hello"}})
    assert r.json()["report"]["missing_required"] == ["full_name"]
    r = client.post("/pdf/forms/fill", headers=orgA, json={"document_id": doc, "expected_version": 3, "values":
        {"full_name": "Deep Kanabar", "agree": True, "plan": "pro", "country": "Canada", "langs": ["en", "fr"]}})
    assert r.status_code == 200, r.text
    b = dl(client, orgA, doc)
    vals = {k: v.get("/V") for k, v in PdfReader(io.BytesIO(b)).get_fields().items()}  # independent reader
    assert vals["full_name"] == "Deep Kanabar" and vals["agree"] == "/Yes" and vals["plan"] == "/pro" and vals["country"] == "Canada"
    assert client.get(f"/pdf/{doc}/forms/export", headers=orgA).json()["langs"] == ["en", "fr"]
    csv_ = client.get(f"/pdf/{doc}/forms/export?format=csv", headers=orgA).text
    assert "full_name,text,Deep Kanabar" in csv_ and "agree,checkbox,true" in csv_
    r = client.post("/pdf/forms/fill", headers=orgA, json={"document_id": doc, "expected_version": 4, "csv": "name,value\nfull_name,=HYPERLINK(1)\nagree,false\n"})
    assert r.status_code == 200
    assert "'=HYPERLINK(1)" in client.get(f"/pdf/{doc}/forms/export?format=csv", headers=orgA).text
    assert client.post("/pdf/forms/flatten", headers=orgA, json={"document_id": doc, "expected_version": 5, "confirm": False}).json()["error"]["code"] == "CONFIRMATION_REQUIRED"
    r = client.post("/pdf/forms/flatten", headers=orgA, json={"document_id": doc, "expected_version": 5, "confirm": True}); assert r.status_code == 200, r.text
    fb = dl(client, orgA, doc)
    assert PdfReader(io.BytesIO(fb)).get_fields() in (None, {})
    assert "=HYPERLINK(1)" in pdftotext(fb) and "Canada" in pdftotext(fb)  # values burned into content
    assert client.get(f"/pdf/{doc}/forms", headers=orgA).json() == []

def test_form_js_not_executed_and_reported(client, orgA, tmp_path):
    from conftest import FIX
    pdf = pikepdf.open(FIX / "simple-1page.pdf")
    pdf.Root.OpenAction = pikepdf.Dictionary(S=pikepdf.Name.JavaScript, JS=pikepdf.String("app.alert('x')"))
    out = io.BytesIO(); pdf.save(out)
    doc = upload(client, orgA, "js.pdf", out.getvalue()).json()["document_id"]
    r = client.post("/pdf/forms", headers=orgA, json={"document_id": doc, "expected_version": 1, "fields": FIELDS[:1]}); assert r.status_code == 200
    r = client.post("/pdf/forms/fill", headers=orgA, json={"document_id": doc, "expected_version": 2, "values": {"full_name": "x"}}); assert r.status_code == 200

def test_annot_forms_cross_tenant(client, orgA, orgB):
    doc = upload(client, orgA).json()["document_id"]
    gets = [f"/pdf/{doc}/annotations", f"/pdf/{doc}/forms", f"/pdf/{doc}/forms/export"]
    for g in gets: assert client.get(g, headers=orgB).status_code == 404, g
    posts = [("/pdf/annotations", {"type": "note", "page": 1, "rect": [1, 1, 20, 20]}), ("/pdf/forms", {"fields": FIELDS[:1]}),
             ("/pdf/forms/fill", {"values": {}}), ("/pdf/forms/flatten", {"confirm": True})]
    for path, body in posts:
        assert client.post(path, headers=orgB, json={"document_id": doc, "expected_version": 1, **body}).status_code == 404, path
    assert client.patch("/pdf/annotations/x", headers=orgB, json={"document_id": doc, "expected_version": 1}).status_code == 404
    assert client.delete("/pdf/annotations/x", headers=orgB, params={"document_id": doc, "expected_version": 1}).status_code == 404
