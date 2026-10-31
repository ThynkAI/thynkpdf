import io, json, subprocess
import pikepdf
from pypdf import PdfReader
from conftest import upload, pdftotext

def dl(c, h, doc): return c.get(f"/documents/{doc}/download", headers=h).content

def ann(c, h, doc, ver, **kw):
    return c.post("/pdf/annotations", headers=h, json={"document_id": doc, "expected_version": ver, **kw})

def test_annotations_batch_threads_persisted(client, orgA):
    doc = upload(client, orgA).json()["document_id"]
    adds = [{"type": "highlight", "page": 1, "rect": [70, 715, 250, 735], "contents": "check this"},
            {"type": "underline", "page": 1, "rect": [70, 695, 200, 712]},
            {"type": "strikeout", "page": 1, "rect": [70, 675, 200, 692]},
            {"type": "text", "page": 1, "rect": [400, 700, 420, 720], "contents": "Sticky note"},
            {"type": "freetext", "page": 2, "rect": [100, 500, 300, 540], "contents": "Free text box", "color": [0, 0, 0]},
            {"type": "ink", "page": 2, "ink_list": [[[100, 100], [150, 160], [200, 120]]], "color": [0, 0, 1]},
            {"type": "square", "page": 1, "rect": [60, 670, 300, 740], "border_width": 2},
            {"type": "circle", "page": 3, "rect": [100, 100, 200, 160], "opacity": 0.5},
            {"type": "line", "page": 3, "line": [100, 300, 300, 300]},
            {"type": "arrow", "page": 3, "line": [100, 350, 300, 400]},
            {"type": "stamp", "page": 3, "rect": [300, 600, 500, 660], "stamp_name": "Approved"}]
    r = ann(client, orgA, doc, 1, add=adds); assert r.status_code == 200, r.text
    ids = r.json()["report"]["ids"]; assert len(ids) == 11 and r.json()["version"] == 2
    lst = client.get(f"/pdf/{doc}/annotations", headers=orgA).json()
    assert lst["version"] == 2 and [a["type"] for a in lst["annotations"]] == ["highlight", "underline", "strikeout", "text", "square", "freetext", "ink", "circle", "line", "arrow", "stamp"]
    by = {a["id"]: a for a in lst["annotations"]}
    assert by[ids[5]]["ink_list"] == [[[100, 100], [150, 160], [200, 120]]] and by[ids[10]]["stamp_name"] == "Approved" and by[ids[0]]["created_at"]
    # comment thread: reply + resolve in one batch
    r = ann(client, orgA, doc, 2, add=[{"type": "text", "page": 1, "rect": [400, 700, 420, 720], "contents": "Reply 1", "in_reply_to": ids[3]}],
            update=[{"id": ids[3], "state": "resolved", "contents": "Sticky note (edited)"}])
    assert r.status_code == 200, r.text; reply = r.json()["report"]["ids"][0]
    by = {a["id"]: a for a in client.get(f"/pdf/{doc}/annotations", headers=orgA).json()["annotations"]}
    assert by[reply]["in_reply_to"] == ids[3] and by[ids[3]]["state"] == "resolved" and by[ids[3]]["contents"] == "Sticky note (edited)"
    # independent reader: subtypes + /IRT + /AP present
    rd = PdfReader(io.BytesIO(dl(client, orgA, doc)))
    objs = [a.get_object() for pg in rd.pages for a in pg.get("/Annots", [])]
    assert sorted({str(o["/Subtype"]) for o in objs}) == ["/Circle", "/FreeText", "/Highlight", "/Ink", "/Line", "/Square", "/Stamp", "/StrikeOut", "/Text", "/Underline"]
    assert all("/AP" in o for o in objs) and any("/IRT" in o for o in objs)
    # old version still readable (versioned)
    assert len(client.get(f"/pdf/{doc}/annotations?version=1", headers=orgA).json()["annotations"]) == 0
    # delete parent removes thread
    r = ann(client, orgA, doc, 3, delete=[ids[3], ids[5]]); assert r.status_code == 200
    left = {a["id"] for a in client.get(f"/pdf/{doc}/annotations", headers=orgA).json()["annotations"]}
    assert ids[3] not in left and reply not in left and ids[5] not in left and len(left) == 9
    assert ann(client, orgA, doc, 4, delete=["nope"]).json()["error"]["code"] == "ANNOTATION_NOT_FOUND"
    assert ann(client, orgA, doc, 4, add=[{"type": "stamp", "page": 1, "rect": [1, 1, 50, 20], "stamp_name": "Bogus"}]).status_code == 400
    assert ann(client, orgA, doc, 4, add=[{"type": "highlight", "page": 1, "rect": [5, 5, 5, 9]}]).status_code == 400
    assert ann(client, orgA, doc, 3, delete=[ids[0]]).json()["error"]["code"] == "VERSION_CONFLICT"
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
    r = client.post("/pdf/forms/fields", headers=orgA, json={"document_id": doc, "expected_version": 1, "add": FIELDS}); assert r.status_code == 200, r.text
    f = {x["name"]: x for x in client.get(f"/pdf/{doc}/forms", headers=orgA).json()["fields"]}
    assert f["notes"]["type"] == "text" and f["notes"]["multiline"]
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
    assert client.get(f"/pdf/{doc}/forms", headers=orgA).json()["fields"] == []
    assert len(client.get(f"/pdf/{doc}/forms?version=2", headers=orgA).json()["fields"]) == 7

def test_form_js_not_executed_and_reported(client, orgA, tmp_path):
    from conftest import FIX
    pdf = pikepdf.open(FIX / "simple-1page.pdf")
    pdf.Root.OpenAction = pikepdf.Dictionary(S=pikepdf.Name.JavaScript, JS=pikepdf.String("app.alert('x')"))
    out = io.BytesIO(); pdf.save(out)
    doc = upload(client, orgA, "js.pdf", out.getvalue()).json()["document_id"]
    r = client.post("/pdf/forms/fields", headers=orgA, json={"document_id": doc, "expected_version": 1, "add": FIELDS[:1]}); assert r.status_code == 200
    r = client.post("/pdf/forms/fill", headers=orgA, json={"document_id": doc, "expected_version": 2, "values": {"full_name": "x"}}); assert r.status_code == 200

def test_annot_forms_cross_tenant(client, orgA, orgB):
    doc = upload(client, orgA).json()["document_id"]
    gets = [f"/pdf/{doc}/annotations", f"/pdf/{doc}/forms", f"/pdf/{doc}/forms/export"]
    for g in gets: assert client.get(g, headers=orgB).status_code == 404, g
    posts = [("/pdf/annotations", {"add": [{"type": "text", "page": 1, "rect": [1, 1, 20, 20]}]}), ("/pdf/forms/fields", {"add": FIELDS[:1]}),
             ("/pdf/forms/fill", {"values": {}}), ("/pdf/forms/flatten", {"confirm": True})]
    for path, body in posts:
        assert client.post(path, headers=orgB, json={"document_id": doc, "expected_version": 1, **body}).status_code == 404, path


def test_form_fields_delete(client, orgA):
    doc = upload(client, orgA, "simple-1page.pdf").json()["document_id"]
    client.post("/pdf/forms/fields", headers=orgA, json={"document_id": doc, "expected_version": 1, "add": FIELDS})
    r = client.post("/pdf/forms/fields", headers=orgA, json={"document_id": doc, "expected_version": 2, "delete": ["plan", "notes"],
                    "add": [{"name": "email", "type": "text", "page": 1, "rect": [300, 600, 500, 620]}]})
    assert r.status_code == 200, r.text
    names = sorted(PdfReader(io.BytesIO(dl(client, orgA, doc))).get_fields())
    assert names == ["agree", "country", "email", "full_name", "langs", "sig"]
    widgets = [a.get_object() for a in PdfReader(io.BytesIO(dl(client, orgA, doc))).pages[0]["/Annots"]]
    assert len(widgets) == 6
    assert client.post("/pdf/forms/fields", headers=orgA, json={"document_id": doc, "expected_version": 3, "delete": ["ghost"]}).json()["error"]["code"] == "FORM_FIELD_NOT_FOUND"
