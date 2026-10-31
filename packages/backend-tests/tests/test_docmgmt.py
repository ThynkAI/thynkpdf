import hashlib
from datetime import datetime, timedelta, timezone
from conftest import upload

def login(c, email, pw): return {"Authorization": "Bearer " + c.post("/auth/login", json={"email": email, "password": pw}).json()["access_token"]}
def ids(r): return [d["document_id"] for d in r.json()["items"]]

def test_folders_tags_star_search_sort_cursor(client, orgA):
    f = client.post("/folders", headers=orgA, json={"name": "Contracts"}).json()
    sub = client.post("/folders", headers=orgA, json={"name": "2026", "parent_id": f["folder_id"]}).json()
    assert client.post("/folders", headers=orgA, json={"name": "Contracts"}).json()["error"]["code"] == "FOLDER_EXISTS"
    assert client.patch(f"/folders/{f['folder_id']}", headers=orgA, json={"parent_id": sub["folder_id"]}).json()["error"]["code"] == "FOLDER_CYCLE"
    d1 = upload(client, orgA).json()["document_id"]; d2 = upload(client, orgA, "simple-1page.pdf").json()["document_id"]
    r = client.patch(f"/documents/{d1}", headers=orgA, json={"folder_id": sub["folder_id"], "tags": ["NDA", "client-x"], "filename": "../acme nda.pdf", "starred": True})
    assert r.status_code == 200, r.text
    j = r.json(); assert j["tags"] == ["client-x", "nda"] and j["filename"] == "acme nda.pdf" and j["starred"] and j["page_count"] == 3 and j["size"] > 0 and j["updated_at"]
    assert ids(client.get(f"/documents?folder_id={sub['folder_id']}", headers=orgA)) == [d1]
    assert ids(client.get("/documents?tag=nda", headers=orgA)) == [d1]
    assert ids(client.get("/documents?folder_id=root", headers=orgA)) == [d2]
    assert ids(client.get("/documents?q=acme", headers=orgA)) == [d1]
    assert ids(client.get("/documents?starred=true", headers=orgA)) == [d1] and ids(client.get("/documents?starred=false", headers=orgA)) == [d2]
    assert ids(client.get("/documents?sort=name&order=asc", headers=orgA)) == [d1, d2]
    assert ids(client.get("/documents?sort=updated_at&order=desc", headers=orgA))[0] == d1  # patched most recently
    p1 = client.get("/documents?limit=1&sort=name&order=asc", headers=orgA).json(); assert len(p1["items"]) == 1 and p1["next_cursor"]
    p2 = client.get(f"/documents?limit=1&sort=name&order=asc&cursor={p1['next_cursor']}", headers=orgA).json()
    assert [x["document_id"] for x in p2["items"]] == [d2] and p2["next_cursor"] is None
    assert client.get("/tags", headers=orgA).json() == ["client-x", "nda"]
    assert client.patch(f"/documents/{d1}", headers=orgA, json={"tags": ["bad tag!"]}).status_code == 422
    assert client.delete(f"/folders/{sub['folder_id']}", headers=orgA).json()["error"]["code"] == "FOLDER_NOT_EMPTY"
    client.patch(f"/documents/{d1}", headers=orgA, json={"folder_id": "root"})
    assert client.delete(f"/folders/{sub['folder_id']}", headers=orgA).status_code == 204

def test_trash_restore_purge(client, orgA, tmp_path):
    d = upload(client, orgA).json()["document_id"]
    assert client.delete(f"/documents/{d}?permanent=true", headers=orgA).json()["error"]["code"] == "NOT_IN_TRASH"
    assert client.delete(f"/documents/{d}", headers=orgA).json()["trashed_at"]
    assert client.get(f"/documents/{d}", headers=orgA).status_code == 404 and client.get(f"/documents/{d}/download", headers=orgA).status_code == 404
    assert ids(client.get("/documents", headers=orgA)) == [] and ids(client.get("/documents?trashed=true", headers=orgA)) == [d]
    assert client.post(f"/documents/{d}/restore", headers=orgA).status_code == 200
    assert client.get(f"/documents/{d}/download", headers=orgA).content[:5] == b"%PDF-"
    assert client.post(f"/documents/{d}/restore", headers=orgA).json()["error"]["code"] == "NOT_IN_TRASH"
    client.post("/pdf/pages/rotate", headers=orgA, json={"document_id": d, "expected_version": 1, "angle": 90})
    client.delete(f"/documents/{d}", headers=orgA)
    store = client.app.state.storage
    keys = [p for p in store.root.rglob("*.pdf") if d in str(p)]; assert len(keys) == 2
    assert client.delete(f"/documents/{d}?permanent=true", headers=orgA).status_code == 204
    assert [p for p in store.root.rglob("*.pdf") if d in str(p)] == []
    assert ids(client.get("/documents?trashed=true", headers=orgA)) == []
    assert client.post(f"/documents/{d}/restore", headers=orgA).status_code == 404
    assert any(a["action"] == "document.purge" for a in client.get("/audit", headers=orgA).json())

def test_restore_version(client, orgA):
    up = upload(client, orgA).json(); d = up["document_id"]
    r2 = client.post("/pdf/pages/rotate", headers=orgA, json={"document_id": d, "expected_version": 1, "angle": 90}).json()
    r = client.post(f"/documents/{d}/versions/{up['version_id']}/restore", headers=orgA); assert r.status_code == 200, r.text
    assert r.json()["version"] == 3 and r.json()["sha256"] == up["sha256"]
    assert hashlib.sha256(client.get(f"/documents/{d}/download", headers=orgA).content).hexdigest() == up["sha256"]
    assert [v["operation"] for v in client.get(f"/documents/{d}/versions", headers=orgA).json()] == ["upload", "rotate", "restore_version"]
    assert client.post(f"/documents/{d}/versions/{r2['version_id']}/restore", headers=orgA, json={"expected_version": 2}).json()["error"]["code"] == "VERSION_CONFLICT"
    assert client.post(f"/documents/{d}/versions/nope/restore", headers=orgA).json()["error"]["code"] == "VERSION_NOT_FOUND"

def test_shares_users_links_expiry(client, orgA):
    for e, role in [("m1@orga.example.com", "member"), ("m2@orga.example.com", "member"), ("v1@orga.example.com", "viewer")]:
        client.post("/orgs/members", headers=orgA, json={"email": e, "password": "member-pass-1", "role": role})
    m1, m2, v1 = (login(client, e, "member-pass-1") for e in ["m1@orga.example.com", "m2@orga.example.com", "v1@orga.example.com"])
    d = upload(client, m1).json()["document_id"]
    assert client.patch(f"/documents/{d}", headers=m2, json={"visibility": "restricted"}).json()["error"]["code"] == "FORBIDDEN_ROLE"
    assert client.patch(f"/documents/{d}", headers=m1, json={"visibility": "restricted"}).status_code == 200
    assert client.get(f"/documents/{d}", headers=m2).status_code == 404 and client.get("/documents", headers=m2).json()["items"] == []
    g = client.post(f"/documents/{d}/shares", headers=m1, json={"email": "m2@orga.example.com", "role": "viewer"}).json()
    assert g["kind"] == "user" and g["role"] == "viewer" and g["url"] is None
    assert client.get(f"/documents/{d}/download", headers=m2).status_code == 200
    assert client.post("/pdf/pages/rotate", headers=m2, json={"document_id": d, "expected_version": 1, "angle": 90}).json()["error"]["code"] == "FORBIDDEN_SHARE"
    client.post(f"/documents/{d}/shares", headers=m1, json={"email": "m2@orga.example.com", "role": "editor"})
    assert client.post("/pdf/pages/rotate", headers=m2, json={"document_id": d, "expected_version": 1, "angle": 90}).status_code == 200
    assert client.patch(f"/documents/{d}", headers=v1, json={"starred": True}).status_code == 404  # not shared with viewer
    client.post(f"/documents/{d}/shares", headers=m1, json={"email": "v1@orga.example.com", "role": "viewer"})
    assert client.patch(f"/documents/{d}", headers=v1, json={"starred": True}).json()["starred"] is True  # viewers may star
    assert client.delete(f"/shares/{g['share_id']}", headers=m1).status_code == 204
    assert client.get(f"/documents/{d}", headers=m2).status_code == 404
    assert client.post(f"/documents/{d}/shares", headers=m1, json={"email": "b@orgb.example.com"}).json()["error"]["code"] == "USER_NOT_IN_ORG"
    # expired grant ignored
    past = (datetime.now(timezone.utc) - timedelta(days=1)).isoformat()
    assert client.post(f"/documents/{d}/shares", headers=m1, json={"email": "m2@orga.example.com", "expires_at": past}).status_code == 422
    # public link
    assert client.post(f"/documents/{d}/shares", headers=m1, json={"email": None, "role": "editor"}).json()["error"]["code"] == "LINK_EDITOR_NOT_SUPPORTED"
    ln = client.post(f"/documents/{d}/shares", headers=m1, json={"email": None}).json(); assert ln["kind"] == "link" and ln["url"].startswith("/shared/")
    assert "url" not in str([x for x in client.get(f"/documents/{d}/shares", headers=m1).json() if x["url"]])
    meta = client.get(ln["url"]).json(); assert meta["page_count"] == 3
    assert client.get(meta["file_path"]).content[:5] == b"%PDF-"
    assert client.get(meta["file_path"], headers={"Range": "bytes=0-3"}).status_code == 206
    assert client.get("/shared/bogus").status_code == 404
    client.delete(f"/shares/{ln['share_id']}", headers=m1)
    assert client.get(ln["url"]).status_code == 404
    soon = (datetime.now(timezone.utc) + timedelta(seconds=1)).isoformat()
    ln2 = client.post(f"/documents/{d}/shares", headers=m1, json={"email": None, "expires_at": soon}).json()
    from thynkpdf_api.db import ShareGrant
    with client.app.state.sessions() as s:
        s.get(ShareGrant, ln2["share_id"]).expires_at = datetime.now(timezone.utc) - timedelta(seconds=5); s.commit()
    assert client.get(ln2["url"]).status_code == 404

def test_docmgmt_cross_tenant(client, orgA, orgB):
    d = upload(client, orgA).json()["document_id"]; vid = client.get(f"/documents/{d}", headers=orgA).json()["version_id"]
    f = client.post("/folders", headers=orgA, json={"name": "A-only"}).json()["folder_id"]
    sh = client.post(f"/documents/{d}/shares", headers=orgA, json={"email": None}).json()
    assert client.get("/folders", headers=orgB).json() == [] and client.get("/tags", headers=orgB).json() == []
    assert client.patch(f"/folders/{f}", headers=orgB, json={"name": "x"}).status_code == 404
    assert client.delete(f"/folders/{f}", headers=orgB).status_code == 404
    assert client.patch(f"/documents/{d}", headers=orgB, json={"tags": ["x"]}).status_code == 404
    assert client.patch(f"/documents/{d}", headers=orgB, json={"starred": True}).status_code == 404
    assert client.delete(f"/documents/{d}", headers=orgB).status_code == 404
    assert client.delete(f"/documents/{d}?permanent=true", headers=orgB).status_code == 404
    assert client.post(f"/documents/{d}/restore", headers=orgB).status_code == 404
    assert client.get(f"/documents/{d}/shares", headers=orgB).status_code == 404
    assert client.post(f"/documents/{d}/shares", headers=orgB, json={"email": None}).status_code == 404
    assert client.delete(f"/shares/{sh['share_id']}", headers=orgB).status_code == 404
    assert client.post(f"/documents/{d}/versions/{vid}/restore", headers=orgB).status_code == 404
    bd = upload(client, orgB).json()["document_id"]
    assert client.patch(f"/documents/{bd}", headers=orgB, json={"folder_id": f}).json()["error"]["code"] == "FOLDER_NOT_FOUND"
    client.delete(f"/documents/{d}", headers=orgA); assert client.get("/documents?trashed=true", headers=orgB).json()["items"] == []
