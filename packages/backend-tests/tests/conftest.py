import io, subprocess, pytest
from pathlib import Path
from fastapi.testclient import TestClient
FIX = Path(__file__).resolve().parents[1] / "fixtures"

@pytest.fixture
def client(tmp_path, monkeypatch):
    from thynkpdf_api.config import settings
    monkeypatch.setattr(settings, "max_upload", 200_000)
    from thynkpdf_api.main import create_app
    return TestClient(create_app(f"sqlite:///{tmp_path}/t.db", str(tmp_path / "obj")))

def reg(c, email, org):
    r = c.post("/auth/register", json={"email": email, "password": "correct-horse-1", "org_name": org}); assert r.status_code == 201, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}

@pytest.fixture
def orgA(client): return reg(client, "a@orga.example.com", "OrgA")
@pytest.fixture
def orgB(client): return reg(client, "b@orgb.example.com", "OrgB")

def upload(c, h, name="simple-3page.pdf", data=None):
    data = data if data is not None else (FIX / name).read_bytes()
    return c.post("/documents/upload", headers=h, files={"file": (name, data, "application/pdf")})

def pdftotext(b: bytes) -> str:
    return subprocess.run(["pdftotext", "-layout", "-", "-"], input=b, capture_output=True, check=True).stdout.decode()
