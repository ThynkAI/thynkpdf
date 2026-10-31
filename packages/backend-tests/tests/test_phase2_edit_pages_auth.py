import io
from pypdf import PdfReader
from conftest import upload, pdftotext, reg

def edit(c, h, doc, ver, *ops):
    return c.post("/pdf/edit", headers=h, json={"document_id": doc, "expected_version": ver, "operations": list(ops)})

def dl(c, h, doc): return c.get(f"/documents/{doc}/download", headers=h).content

def test_text_insert_delete_move(client, orgA):
    up = upload(client, orgA).json(); doc = up["document_id"]; assert up["filename"] == "simple-3page.pdf"
    r = edit(client, orgA, doc, 1, {"op": "text_insert", "page": 1, "text": "Inserted Café note", "x": 72, "y": 500, "font": "Courier", "font_size": 10})
    assert r.status_code == 200, r.text
    r = edit(client, orgA, doc, 2, {"op": "text_delete", "page": 1, "find": "Total due: "})
    assert r.status_code == 200, r.text
    b = dl(client, orgA, doc)
    t = pdftotext(b).split("\x0c")[0]; assert "Inserted Café note" in t and "Total due" not in t and "100 USD" in t
    def ypos(b, needle):
        out = []
        def v(text, cm, tm, fd, fs):
            if needle in text: out.append(tm[5] * cm[3] + cm[5])
        PdfReader(io.BytesIO(b)).pages[0].extract_text(visitor_text=v); return out[0]
    y0 = ypos(b, "Page marker")
    r = edit(client, orgA, doc, 3, {"op": "text_move", "page": 1, "find": "Page marker P1", "dx": 0, "dy": -300})
    assert r.status_code == 200, r.text
    b2 = dl(client, orgA, doc); assert abs((y0 - ypos(b2, "Page marker")) - 300) < 0.01
    assert "Page marker P1" in pdftotext(b2)
    # limits stay honest
    emb = upload(client, orgA, "embedded-font.pdf").json()["document_id"]
    for op in [{"op": "text_delete", "page": 1, "find": "Embedded"}, {"op": "text_move", "page": 1, "find": "Embedded", "dx": 1, "dy": 1}]:
        assert edit(client, orgA, emb, 1, op).json()["error"]["code"] == "EDIT_NOT_SUPPORTED"
    assert edit(client, orgA, doc, 4, {"op": "text_insert", "page": 1, "text": "Ω", "x": 1, "y": 1}).json()["error"]["code"] == "EDIT_UNSUPPORTED_CHARACTERS"
    assert edit(client, orgA, doc, 4, {"op": "text_insert", "page": 1, "text": "x", "x": 1, "y": 1, "font": "Arial"}).json()["error"]["code"] == "EDIT_UNSUPPORTED_FONT"

def test_page_insert_delete_duplicate(client, orgA):
    doc = upload(client, orgA).json()["document_id"]
    j = lambda path, body: client.post(path, headers=orgA, json={"document_id": doc, **body})
    assert j("/pdf/pages/insert-blank", {"expected_version": 1, "after_page": 1, "count": 2}).status_code == 200
    b = dl(client, orgA, doc); rd = PdfReader(io.BytesIO(b)); assert len(rd.pages) == 5 and rd.pages[1].extract_text() == ""
    assert j("/pdf/pages/delete", {"expected_version": 2, "pages": [2, 3]}).status_code == 200
    assert j("/pdf/pages/duplicate", {"expected_version": 3, "pages": [3]}).status_code == 200
    rd = PdfReader(io.BytesIO(dl(client, orgA, doc)))
    assert [p.extract_text().splitlines()[1] for p in rd.pages] == ["Page marker P1", "Page marker P2", "Page marker P3", "Page marker P3"]
    assert j("/pdf/pages/delete", {"expected_version": 4, "pages": [1, 2, 3, 4]}).json()["error"]["code"] == "CANNOT_DELETE_ALL_PAGES"
    assert j("/pdf/pages/delete", {"expected_version": 1, "pages": [1]}).json()["error"]["code"] == "VERSION_CONFLICT"

def test_new_routes_cross_tenant(client, orgA, orgB):
    doc = upload(client, orgA).json()["document_id"]
    for path, body in [("/pdf/pages/insert-blank", {"expected_version": 1}), ("/pdf/pages/delete", {"expected_version": 1, "pages": [1]}),
                       ("/pdf/pages/duplicate", {"expected_version": 1, "pages": [1]}),
                       ("/pdf/pages/insert-from", {"expected_version": 1, "source_document_id": doc, "after_page": 0}),
                       ("/pdf/edit", {"expected_version": 1, "operations": [{"op": "text_insert", "page": 1, "text": "x", "x": 1, "y": 1}]})]:
        assert client.post(path, headers=orgB, json={"document_id": doc, **body}).status_code == 404, path

def test_capabilities_schema(client, orgA):
    doc = upload(client, orgA).json()["document_id"]
    cap = client.get(f"/pdf/{doc}/capabilities", headers=orgA).json()
    assert cap["edit_ops"] == {"text_replace": True, "text_delete": True, "text_move": True, "text_insert": True}
    spec = client.get("/openapi.json").json()
    ref = spec["paths"]["/pdf/{doc_id}/capabilities"]["get"]["responses"]["200"]["content"]["application/json"]["schema"]["$ref"]
    assert ref.endswith("/CapabilitiesOut") and "PageCapability" in spec["components"]["schemas"]

def test_refresh_cookie_rotation_logout(client):
    r = client.post("/auth/register", json={"email": "c@orgc.example.com", "password": "correct-horse-1", "org_name": "C"})
    sc = r.headers["set-cookie"].lower()
    assert "thynkpdf_rt=" in sc and "httponly" in sc and "samesite=strict" in sc and "path=/auth" in sc and "secure" not in sc
    first = r.cookies.get("thynkpdf_rt") or client.cookies.get("thynkpdf_rt")
    r2 = client.post("/auth/refresh")  # no body: cookie only
    assert r2.status_code == 200, r2.text
    # replay of the used refresh token is rejected (rotation)
    assert client.post("/auth/refresh", json={"refresh_token": first}).json()["error"]["code"] == "TOKEN_REVOKED"
    assert client.post("/auth/logout").status_code == 204
    assert client.post("/auth/refresh").status_code == 401
    pre = client.options("/auth/refresh", headers={"Origin": "http://localhost:3000", "Access-Control-Request-Method": "POST"})
    assert pre.headers["access-control-allow-origin"] == "http://localhost:3000" and pre.headers["access-control-allow-credentials"] == "true"


def test_duplicate_position_and_insert_from(client, orgA, orgB):
    doc = upload(client, orgA).json()["document_id"]
    src = upload(client, orgA, "simple-1page.pdf").json()["document_id"]
    j = lambda path, body: client.post(path, headers=orgA, json={"document_id": doc, **body})
    assert j("/pdf/pages/duplicate", {"expected_version": 1, "pages": [1, 3], "position": 0}).status_code == 200
    marks = lambda: [p.extract_text().splitlines()[1] for p in PdfReader(io.BytesIO(dl(client, orgA, doc))).pages]
    assert marks() == ["Page marker P1", "Page marker P3", "Page marker P1", "Page marker P2", "Page marker P3"]
    r = j("/pdf/pages/insert-from", {"expected_version": 2, "source_document_id": src, "after_page": 5}); assert r.status_code == 200, r.text
    assert r.json()["filename"] == "simple-3page.pdf" and len(marks()) == 6
    bdoc = upload(client, orgB).json()["document_id"]
    assert j("/pdf/pages/insert-from", {"expected_version": 3, "source_document_id": bdoc, "after_page": 0}).status_code == 404

def test_upload_new_version_multipart(client, orgA, orgB):
    from conftest import FIX
    up = upload(client, orgA).json(); doc = up["document_id"]
    new = (FIX / "simple-1page.pdf").read_bytes()
    post = lambda h, data, ev, name="edited.pdf": client.post(f"/documents/{doc}/versions", headers=h, data={"expected_version": str(ev)},
                                                             files={"file": (name, data, "application/pdf")})
    r = post(orgA, new, 1); assert r.status_code == 201, r.text
    assert r.json()["version"] == 2 and r.json()["report"]["page_count"] == 1
    assert dl(client, orgA, doc) == new
    assert post(orgA, new, 1).json()["error"]["code"] == "VERSION_CONFLICT"
    assert post(orgA, b"\x89PNG....", 2).json()["error"]["code"] == "INVALID_FILE_TYPE"
    assert post(orgA, (FIX / "malformed.pdf").read_bytes(), 2).json()["error"]["code"] == "PDF_MALFORMED"
    assert post(orgA, b"%PDF-1.7\n" + b"0" * 300_000, 2).json()["error"]["code"] == "FILE_TOO_LARGE"
    assert post(orgB, new, 2).status_code == 404
    assert client.get(f"/documents/{doc}", headers=orgA).json()["current_version"] == 2
