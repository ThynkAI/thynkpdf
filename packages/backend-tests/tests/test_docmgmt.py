import hashlib
from conftest import upload

def login(c, email, pw): return {"Authorization": "Bearer " + c.post("/auth/login", json={"email": email, "password": pw}).json()["access_token"]}

def test_folders_tags_search(client, orgA):
    f = client.post("/folders", headers=orgA, json={"name": "Contracts"}).json()
    sub = client.post("/folders", headers=orgA, json={"name": "2026", "parent_id": f["folder_id"]}).json()
    assert client.post("/folders", headers=orgA, json={"name": "Contracts"}).json()["error"]["code"] == "FOLDER_EXISTS"
    assert client.patch(f"/folders/{f['folder_id']}", headers=orgA, json={"parent_id": sub["folder_id"]}).json()["error"]["code"] == "FOLDER_CYCLE"
    d1 = upload(client, orgA).json()["document_id"]; upload(client, orgA, "simple-1page.pdf")
    r = client.patch(f"/documents/{d1}", headers=orgA, json={"folder_id": sub["folder_id"], "tags": ["NDA", "client-x"], "filename": "../acme nda.pdf"})
    assert r.status_code == 200, r.text and r.json()["tags"] == ["client-x", "nda"]
    assert r.json()["filename"] == "acme nda.pdf"
    assert [d["document_id"] for d in client.get(f"/documents?folder_id={sub['folder_id']}", headers=orgA).json()] == [d1]
    assert [d["document_id"] for d in client.get("/documents?tag=nda", headers=orgA).json()] == [d1]
    assert len(client.get("/documents?folder_id=root", headers=orgA).json()) == 1
    assert [d["document_id"] for d in client.get("/documents?q=acme", headers=orgA).json()] == [d1]
    assert client.get("/tags", headers=orgA).json() == ["client-x", "nda"]
    assert client.patch(f"/documents/{d1}", headers=orgA, json={"tags": ["bad tag!"]}).status_code == 422
    assert client.delete(f"/folders/{sub['folder_id']}", headers=orgA).json()["error"]["code"] == "FOLDER_NOT_EMPTY"
    client.patch(f"/documents/{d1}", headers=orgA, json={"folder_id": "root"})
    assert client.delete(f"/folders/{sub['folder_id']}", headers=orgA).status_code == 204

def test_trash_restore(client, orgA):
    d = upload(client, orgA).json()["document_id"]
    assert client.delete(f"/documents/{d}", headers=orgA).json()["deleted_at"]
    assert client.get(f"/documents/{d}", headers=orgA).status_code == 404
    assert client.get(f"/documents/{d}/download", headers=orgA).status_code == 404
    assert client.get("/documents", headers=orgA).json() == []
    assert [x["document_id"] for x in client.get("/documents-trash", headers=orgA).json()] == [d]
    assert client.post(f"/documents/{d}/restore", headers=orgA).status_code == 200
    assert client.get(f"/documents/{d}/download", headers=orgA).content[:5] == b"%PDF-"
    assert client.post(f"/documents/{d}/restore", headers=orgA).json()["error"]["code"] == "NOT_IN_TRASH"

def test_rollback(client, orgA):
    up = upload(client, orgA).json(); d = up["document_id"]
    client.post("/pdf/pages/rotate", headers=orgA, json={"document_id": d, "expected_version": 1, "angle": 90})
    r = client.post(f"/documents/{d}/rollback", headers=orgA, json={"expected_version": 2, "target_version": 1}); assert r.status_code == 200
    assert r.json()["version"] == 3 and r.json()["sha256"] == up["sha256"]
    assert hashlib.sha256(client.get(f"/documents/{d}/download", headers=orgA).content).hexdigest() == up["sha256"]
    assert [v["operation"] for v in client.get(f"/documents/{d}/versions", headers=orgA).json()] == ["upload", "rotate", "rollback"]
    assert client.post(f"/documents/{d}/rollback", headers=orgA, json={"expected_version": 2, "target_version": 1}).status_code == 409
    assert client.post(f"/documents/{d}/rollback", headers=orgA, json={"expected_version": 3, "target_version": 9}).json()["error"]["code"] == "VERSION_NOT_FOUND"

def test_restricted_visibility_and_shares(client, orgA):
    for e, role in [("m1@orga.example.com", "member"), ("m2@orga.example.com", "member"), ("v1@orga.example.com", "viewer")]:
        client.post("/orgs/members", headers=orgA, json={"email": e, "password": "member-pass-1", "role": role})
    m1, m2, v1 = (login(client, e, "member-pass-1") for e in ["m1@orga.example.com", "m2@orga.example.com", "v1@orga.example.com"])
    d = upload(client, m1).json()["document_id"]
    assert client.get(f"/documents/{d}", headers=m2).status_code == 200
    assert client.patch(f"/documents/{d}", headers=m2, json={"visibility": "restricted"}).json()["error"]["code"] == "FORBIDDEN_ROLE"
    assert client.patch(f"/documents/{d}", headers=m1, json={"visibility": "restricted"}).status_code == 200
    assert client.get(f"/documents/{d}", headers=m2).status_code == 404 and client.get("/documents", headers=m2).json() == []
    assert client.get(f"/documents/{d}", headers=orgA).status_code == 200  # owner/admin still sees
    g = client.post(f"/documents/{d}/shares", headers=m1, json={"email": "m2@orga.example.com", "permission": "view"}).json()
    assert client.get(f"/documents/{d}/download", headers=m2).status_code == 200
    assert client.post("/pdf/pages/rotate", headers=m2, json={"document_id": d, "expected_version": 1, "angle": 90}).json()["error"]["code"] == "FORBIDDEN_SHARE"
    client.post(f"/documents/{d}/shares", headers=m1, json={"email": "m2@orga.example.com", "permission": "edit"})
    assert client.post("/pdf/pages/rotate", headers=m2, json={"document_id": d, "expected_version": 1, "angle": 90}).status_code == 200
    client.post(f"/documents/{d}/shares", headers=m1, json={"email": "v1@orga.example.com", "permission": "edit"})
    assert client.post("/pdf/pages/rotate", headers=v1, json={"document_id": d, "expected_version": 2, "angle": 90}).status_code == 200
    assert client.delete(f"/documents/{d}/shares/{g['grant_id']}", headers=m1).status_code == 204
    assert client.get(f"/documents/{d}", headers=m2).status_code == 404
    assert client.post(f"/documents/{d}/shares", headers=m1, json={"email": "b@orgb.example.com"}).json()["error"]["code"] == "USER_NOT_IN_ORG"

def test_docmgmt_cross_tenant(client, orgA, orgB):
    d = upload(client, orgA).json()["document_id"]
    f = client.post("/folders", headers=orgA, json={"name": "A-only"}).json()["folder_id"]
    assert client.get("/folders", headers=orgB).json() == [] and client.get("/tags", headers=orgB).json() == []
    assert client.patch(f"/folders/{f}", headers=orgB, json={"name": "x"}).status_code == 404
    assert client.delete(f"/folders/{f}", headers=orgB).status_code == 404
    assert client.patch(f"/documents/{d}", headers=orgB, json={"tags": ["x"]}).status_code == 404
    assert client.delete(f"/documents/{d}", headers=orgB).status_code == 404
    assert client.post(f"/documents/{d}/restore", headers=orgB).status_code == 404
    assert client.get(f"/documents/{d}/shares", headers=orgB).status_code == 404
    assert client.post(f"/documents/{d}/shares", headers=orgB, json={"email": "b@orgb.example.com"}).status_code == 404
    assert client.post(f"/documents/{d}/rollback", headers=orgB, json={"expected_version": 1, "target_version": 1}).status_code == 404
    bd = upload(client, orgB).json()["document_id"]
    assert client.patch(f"/documents/{bd}", headers=orgB, json={"folder_id": f}).json()["error"]["code"] == "FOLDER_NOT_FOUND"
    client.delete(f"/documents/{d}", headers=orgA); assert client.get("/documents-trash", headers=orgB).json() == []
