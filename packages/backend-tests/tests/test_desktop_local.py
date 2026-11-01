"""Release-readiness tests: no-account identity, desktop guard (secret + Host + Origin), BD-06 local-only, migrations, route set."""
import os, sqlite3, sys, stat
from pathlib import Path
import pytest
from fastapi.testclient import TestClient
from conftest import FIX, upload

ROOT = Path(__file__).resolve().parents[3]
SECRET = "s" * 43
PORT = 45678
H = {"host": f"127.0.0.1:{PORT}", "x-thynkpdf-key": SECRET}



@pytest.fixture
def desk(tmp_path):
    from thynkpdf_api.main import create_app
    from thynkpdf_api import desktop_guard
    app = create_app(f"sqlite:///{tmp_path}/d.db", str(tmp_path / "obj"), auth_mode="desktop")
    hog = desktop_guard.install(app, PORT, SECRET)

    @app.middleware("http")
    async def outer(request, call_next): return hog(request) or await call_next(request)
    return TestClient(app, base_url=f"http://127.0.0.1:{PORT}")


def test_route_count_includes_all_features():
    from thynkpdf_api.main import create_app
    from thynkpdf_api import features
    paths = {r.path for r in create_app("sqlite://", "/tmp/x-obj").routes}
    assert len(features.MODULES) == 7
    for p in ["/session/local", "/documents/{doc_id}/annotations", "/signature-requests", "/documents/{doc_id}/shares"]:
        assert any(x.startswith(p.split("{")[0]) for x in paths), p


def test_desktop_requires_secret_host_origin(desk):
    assert desk.get("/health", headers={"host": H["host"]}).status_code == 200
    assert desk.post("/session/local", headers={"host": H["host"]}).json()["error"]["code"] == "DESKTOP_KEY_REQUIRED"
    assert desk.post("/session/local", headers={**H, "x-thynkpdf-key": "x" * 43}).status_code == 403
    assert desk.post("/session/local", headers={**H, "host": "attacker.example"}).json()["error"]["code"] == "HOST_NOT_ALLOWED"
    assert desk.post("/session/local", headers={**H, "origin": "http://attacker.example"}).json()["error"]["code"] == "ORIGIN_NOT_ALLOWED"
    r = desk.post("/session/local", headers={**H, "origin": f"http://127.0.0.1:{PORT}"}); assert r.status_code == 200


def test_desktop_session_idempotent_and_no_accounts(desk):
    t1 = desk.post("/session/local", headers=H).json()["access_token"]
    a = {**H, "Authorization": f"Bearer {t1}"}
    assert upload(desk, a).status_code == 201
    t2 = desk.post("/session/local", headers=H).json()["access_token"]
    docs = desk.get("/documents", headers={**H, "Authorization": f"Bearer {t2}"}).json()
    assert len(docs["items"] if isinstance(docs, dict) else docs) == 1
    assert desk.post("/auth/register", headers=H, json={"email": "x@y.example.com", "password": "correct-horse-1", "org_name": "o"}).json()["error"]["code"] == "ACCOUNTS_DISABLED"
    assert desk.post("/auth/login", headers=H, json={"email": "x@y.example.com", "password": "correct-horse-1"}).json()["error"]["code"] == "ACCOUNTS_DISABLED"


def test_desktop_remote_features_local_only(desk):
    a = {**H, "Authorization": "Bearer " + desk.post("/session/local", headers=H).json()["access_token"]}
    d = upload(desk, a).json()["document_id"]
    assert desk.post(f"/documents/{d}/shares", headers=a, json={"email": None}).json()["error"]["code"] == "DESKTOP_LOCAL_ONLY"
    assert desk.post("/signature-requests", headers=a, json={}).json()["error"]["code"] == "DESKTOP_LOCAL_ONLY"


def test_anonymous_per_browser(tmp_path):
    from thynkpdf_api.main import create_app
    c = TestClient(create_app(f"sqlite:///{tmp_path}/a.db", str(tmp_path / "o"), auth_mode="anonymous"))
    k1, k2 = "a" * 40, "b" * 40
    h1 = {"Authorization": "Bearer " + c.post("/session/local", json={"browser_key": k1}).json()["access_token"]}
    assert upload(c, h1).status_code == 201
    h1b = {"Authorization": "Bearer " + c.post("/session/local", json={"browser_key": k1}).json()["access_token"]}
    h2 = {"Authorization": "Bearer " + c.post("/session/local", json={"browser_key": k2}).json()["access_token"]}
    n = lambda h: (lambda j: len(j["items"] if isinstance(j, dict) else j))(c.get("/documents", headers=h).json())
    assert n(h1b) == 1 and n(h2) == 0
    assert c.post("/session/local", json={"browser_key": "short"}).status_code == 422
    assert c.post("/auth/register", json={"email": "x@y.example.com", "password": "correct-horse-1", "org_name": "o"}).status_code == 403


def test_migrate_fresh_legacy_and_newer(tmp_path):
    from thynkpdf_api.desktop_migrate import migrate, MigrationError
    from thynkpdf_api.db import make_session_factory
    mig = ROOT / "migrations"
    r = migrate(tmp_path / "fresh.db", mig); assert r["action"] == "created"
    assert stat.S_IMODE(os.stat(tmp_path / "fresh.db").st_mode) == 0o600
    assert migrate(tmp_path / "fresh.db", mig)["action"] == "none"
    legacy = tmp_path / "legacy.db"; make_session_factory(f"sqlite:///{legacy}")  # create_all, like v0.1.x desktop
    r = migrate(legacy, mig); assert r["action"] == "stamped" and Path(r["backup"]).exists()
    assert migrate(legacy, mig)["action"] == "none"
    con = sqlite3.connect(legacy); con.execute("update alembic_version set version_num='ffffffffffff'"); con.commit(); con.close()
    before = legacy.read_bytes()
    with pytest.raises(MigrationError, match="newer version"): migrate(legacy, mig)
    assert legacy.read_bytes() == before
    bad = tmp_path / "bad.db"; bad.write_bytes(b"not a database" * 100)
    with pytest.raises(MigrationError): migrate(bad, mig)
    assert bad.read_bytes() == b"not a database" * 100


def test_duplicate_keeps_annotations_BD09():
    import io, pikepdf
    from pikepdf import Dictionary, Name, Array
    from thynkpdf_engine import edit
    pdf = pikepdf.new(); pdf.add_blank_page(); pg = pdf.pages[0]
    pg.obj[Name.Annots] = Array([pdf.make_indirect(Dictionary(Type=Name.Annot, Subtype=Name.Text, Rect=[10, 10, 30, 30], Contents=pikepdf.String("hi"), NM=pikepdf.String("a1"))),
                                pdf.make_indirect(Dictionary(Type=Name.Annot, Subtype=Name.Link, Rect=[40, 40, 90, 60]))])
    b = io.BytesIO(); pdf.save(b)
    out = pikepdf.open(io.BytesIO(edit.duplicate_pages(b.getvalue(), [1])))
    a0, a1 = out.pages[0].obj.Annots, out.pages[1].obj.Annots
    assert len(a1) == 2 and sorted(str(x.Subtype) for x in a1) == ["/Link", "/Text"]
    assert str(a1[0].NM) != str(a0[0].NM) and a1[0].P.objgen == out.pages[1].obj.objgen
