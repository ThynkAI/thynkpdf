from conftest import upload, reg, FIX

def test_cross_tenant_denied(client, orgA, orgB):
    up = upload(client, orgA).json(); doc, vid = up["document_id"], up["version_id"]
    for path in [f"/documents/{doc}", f"/documents/{doc}/versions", f"/documents/{doc}/download",
                 f"/documents/{doc}/versions/{vid}/file", f"/pdf/{doc}/metadata", f"/pdf/{doc}/capabilities"]:
        r = client.get(path, headers=orgB); assert r.status_code == 404 and r.json()["error"]["code"] == "DOCUMENT_NOT_FOUND", path
    assert client.get("/documents", headers=orgB).json() == []
    for path, body in [("/pdf/pages/rotate", {"document_id": doc, "expected_version": 1, "angle": 90}),
                       ("/pdf/pages/reorder", {"document_id": doc, "expected_version": 1, "order": [1, 2, 3]}),
                       ("/pdf/pages/extract", {"document_id": doc, "pages": [1]}),
                       ("/pdf/split", {"document_id": doc, "ranges": [[1, 1]]}),
                       ("/pdf/edit", {"document_id": doc, "expected_version": 1, "operations": [{"op": "text_replace", "page": 1, "find": "A", "replacement": "B"}]})]:
        r = client.post(path, headers=orgB, json=body); assert r.status_code == 404, path
    bdoc = upload(client, orgB).json()["document_id"]
    assert client.post("/pdf/merge", headers=orgB, json={"document_ids": [bdoc, doc]}).status_code == 404
    assert client.get(f"/documents/{doc}", headers=orgA).json()["current_version"] == 1

def test_auth_required_and_bad_tokens(client, orgA):
    assert client.get("/documents").json()["error"]["code"] == "AUTH_REQUIRED"
    assert client.get("/documents", headers={"Authorization": "Bearer x.y.z"}).status_code == 401
    r = client.post("/auth/login", json={"email": "a@orga.example.com", "password": "correct-horse-1"}).json()
    assert client.get("/documents", headers={"Authorization": f"Bearer {r['refresh_token']}"}).status_code == 401
    r2 = client.post("/auth/refresh", json={"refresh_token": r["refresh_token"]}); assert r2.status_code == 200 and r2.json()["token_type"] == "bearer"
    assert client.post("/auth/refresh", json={"refresh_token": r["access_token"]}).status_code == 401
    assert client.post("/auth/login", json={"email": "a@orga.example.com", "password": "wrong-password"}).json()["error"]["code"] == "INVALID_CREDENTIALS"

def test_viewer_cannot_write(client, orgA):
    assert client.post("/orgs/members", headers=orgA, json={"email": "v@orga.example.com", "password": "viewer-pass-1", "role": "viewer"}).status_code == 201
    doc = upload(client, orgA).json()["document_id"]
    t = client.post("/auth/login", json={"email": "v@orga.example.com", "password": "viewer-pass-1"}).json()["access_token"]
    hv = {"Authorization": f"Bearer {t}"}
    assert client.get(f"/documents/{doc}", headers=hv).status_code == 200
    assert upload(client, hv).json()["error"]["code"] == "FORBIDDEN_ROLE"
    assert client.post("/pdf/pages/rotate", headers=hv, json={"document_id": doc, "expected_version": 1, "angle": 90}).status_code == 403
    assert client.post("/orgs/members", headers=hv, json={"email": "x@orga.example.com", "password": "xxxxxxxxxxx", "role": "admin"}).status_code == 403

def test_bad_uploads(client, orgA):
    r = upload(client, orgA, "not-a-pdf.pdf"); assert r.status_code == 415 and r.json()["error"]["code"] == "INVALID_FILE_TYPE"
    r = upload(client, orgA, "malformed.pdf"); assert r.status_code == 422 and r.json()["error"]["code"] == "PDF_MALFORMED"
    r = upload(client, orgA, "big.pdf", b"%PDF-1.7\n" + b"0" * 300_000); assert r.status_code == 413 and r.json()["error"]["code"] == "FILE_TOO_LARGE"
    assert client.get("/documents", headers=orgA).json() == []

def test_path_traversal(client, orgA, tmp_path):
    r = upload(client, orgA, "../../../etc/passwd.pdf", (FIX / "simple-1page.pdf").read_bytes()); assert r.status_code == 201
    d = client.get(f"/documents/{r.json()['document_id']}", headers=orgA).json()
    assert "/" not in d["filename"] and ".." not in d["filename"].split("/")
    assert not (tmp_path / "etc").exists()
    assert client.get("/documents/..%2F..%2Fetc%2Fpasswd", headers=orgA).status_code == 404
    from thynkpdf_storage import LocalStorage, StorageError
    import pytest
    st = LocalStorage(str(tmp_path / "s"))
    for bad in ["../x", "orgs/../../x", "/etc/passwd", "a/../b"]:
        with pytest.raises(StorageError): st.put(bad, b"x")
    st.put("orgs/a/b.pdf", b"1")
    with pytest.raises(StorageError): st.put("orgs/a/b.pdf", b"2")  # immutability

def test_no_internal_leak_in_errors(client, orgA):
    r = upload(client, orgA, "malformed.pdf").json()
    assert "Traceback" not in str(r) and "/workspace" not in str(r) and "/tmp" not in str(r)
