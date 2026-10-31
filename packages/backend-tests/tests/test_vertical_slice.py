import io, hashlib
from pypdf import PdfReader
from conftest import upload, pdftotext, FIX, reg

def test_upload_inspect_edit_version_download(client, orgA):
    r = upload(client, orgA); assert r.status_code == 201, r.text
    up = r.json(); doc = up["document_id"]
    assert up["sha256"] == hashlib.sha256((FIX / "simple-3page.pdf").read_bytes()).hexdigest() and up["page_count"] == 3
    m = client.get(f"/pdf/{doc}/metadata", headers=orgA).json()
    assert m["page_count"] == 3 and m["info"]["Title"] == "THYNKPDF Fixture"
    cap = client.get(f"/pdf/{doc}/capabilities", headers=orgA).json()
    assert cap["text_replace"] and cap["pages"][0]["text_replace"]
    e = client.post("/pdf/edit", headers=orgA, json={"document_id": doc, "expected_version": 1, "operations": [
        {"op": "text_replace", "page": 2, "find": "ACME-002", "replacement": "THYNK-777"}]})
    assert e.status_code == 200, e.text; assert e.json()["version"] == 2 and e.json()["report"]["applied"][0]["replacements"] == 1
    vs = client.get(f"/documents/{doc}/versions", headers=orgA).json(); assert [v["number"] for v in vs] == [1, 2]
    new = client.get(f"/documents/{doc}/versions/{e.json()['version_id']}/file", headers=orgA)
    assert new.status_code == 200 and hashlib.sha256(new.content).hexdigest() == e.json()["sha256"]
    # independent verification: pypdf + poppler pdftotext
    t2 = PdfReader(io.BytesIO(new.content)).pages[1].extract_text()
    assert "THYNK-777" in t2 and "ACME-002" not in t2
    pt = pdftotext(new.content); assert "THYNK-777" in pt and "ACME-002" not in pt and "ACME-001" in pt
    # original version immutable
    old = client.get(f"/documents/{doc}/versions/{up['version_id']}/file", headers=orgA).content
    assert "ACME-002" in pdftotext(old) and hashlib.sha256(old).hexdigest() == up["sha256"]

def test_page_ops_and_range(client, orgA):
    doc = upload(client, orgA).json()["document_id"]
    r = client.post("/pdf/pages/rotate", headers=orgA, json={"document_id": doc, "expected_version": 1, "pages": [1], "angle": 90})
    assert r.status_code == 200 and r.json()["version"] == 2
    r = client.post("/pdf/pages/reorder", headers=orgA, json={"document_id": doc, "expected_version": 2, "order": [3, 1, 2]})
    assert r.status_code == 200, r.text
    b = client.get(f"/documents/{doc}/download", headers=orgA).content
    rd = PdfReader(io.BytesIO(b))
    assert "P3" in rd.pages[0].extract_text() and rd.pages[1].rotation == 90
    assert pdftotext(b).index("P3") < pdftotext(b).index("P1")
    rr = client.get(f"/documents/{doc}/download", headers={**orgA, "Range": "bytes=0-7"})
    assert rr.status_code == 206 and rr.content == b[:8] and rr.headers["content-range"] == f"bytes 0-7/{len(b)}"
    assert client.get(f"/documents/{doc}/download", headers={**orgA, "Range": f"bytes={len(b)+5}-"}).status_code == 416
    ex = client.post("/pdf/pages/extract", headers=orgA, json={"document_id": doc, "pages": [2, 3]}); assert ex.status_code == 201
    exb = client.get(f"/documents/{ex.json()['document_id']}/download", headers=orgA).content
    assert len(PdfReader(io.BytesIO(exb)).pages) == 2 and "P1" in pdftotext(exb)
    sp = client.post("/pdf/split", headers=orgA, json={"document_id": doc, "ranges": [[1, 1], [2, 3]]}); assert sp.status_code == 201
    assert [x["page_count"] for x in sp.json()] == [1, 2]
    d2 = upload(client, orgA, "simple-1page.pdf").json()["document_id"]
    mg = client.post("/pdf/merge", headers=orgA, json={"document_ids": [doc, d2]}); assert mg.status_code == 201
    mb = client.get(f"/documents/{mg.json()['document_id']}/download", headers=orgA).content
    assert len(PdfReader(io.BytesIO(mb)).pages) == 4
    assert client.post("/pdf/pages/reorder", headers=orgA, json={"document_id": doc, "expected_version": 3, "order": [1, 1, 2]}).json()["error"]["code"] == "INVALID_ORDER"

def test_version_conflict(client, orgA):
    doc = upload(client, orgA).json()["document_id"]
    body = {"document_id": doc, "expected_version": 1, "angle": 180}
    assert client.post("/pdf/pages/rotate", headers=orgA, json=body).status_code == 200
    r = client.post("/pdf/pages/rotate", headers=orgA, json=body)
    assert r.status_code == 409 and r.json()["error"]["code"] == "VERSION_CONFLICT" and r.json()["error"]["details"]["current_version"] == 2

def test_edit_limitations(client, orgA):
    for f, code in [("embedded-font.pdf", "FONT_NOT_SIMPLE_TYPE1"), ("no-text.pdf", "NO_TEXT_LAYER")]:
        doc = upload(client, orgA, f).json()["document_id"]
        cap = client.get(f"/pdf/{doc}/capabilities", headers=orgA).json()
        assert not cap["text_replace"] and cap["pages"][0]["limitations"][0]["code"] == code
        r = client.post("/pdf/edit", headers=orgA, json={"document_id": doc, "expected_version": 1, "operations": [
            {"op": "text_replace", "page": 1, "find": "Embedded", "replacement": "X"}]})
        assert r.status_code == 422 and r.json()["error"]["code"] == "EDIT_NOT_SUPPORTED"
    doc = upload(client, orgA).json()["document_id"]
    r = client.post("/pdf/edit", headers=orgA, json={"document_id": doc, "expected_version": 1, "operations": [{"op": "text_replace", "page": 1, "find": "nope", "replacement": "x"}]})
    assert r.json()["error"]["code"] == "TEXT_NOT_FOUND"
    r = client.post("/pdf/edit", headers=orgA, json={"document_id": doc, "expected_version": 1, "operations": [{"op": "image_move", "page": 1}]})
    assert r.json()["error"]["code"] == "EDIT_OP_NOT_IMPLEMENTED"
    assert client.get(f"/documents/{doc}", headers=orgA).json()["current_version"] == 1

def test_compress(client, orgA):
    doc = upload(client, orgA).json()["document_id"]
    r = client.post("/pdf/compress", headers=orgA, json={"document_id": doc, "expected_version": 1, "preset": "high"})
    assert r.status_code == 200, r.text; rep = r.json()["report"]
    assert {"original_size", "final_size", "compression_ratio", "duration_ms", "warnings"} <= rep.keys()
    b = client.get(f"/documents/{doc}/download", headers=orgA).content
    assert len(b) == rep["final_size"] and "ACME-003" in pdftotext(b)
