"""Audit regression tests (2026-11-01, Bot 1). NOT in the default testpaths on purpose: several of these FAIL on
7604fc5 and document confirmed defects. Run:
    python tools/audit/make_corpus.py
    THYNKPDF_AUDIT_SIDECAR=<extracted AppImage>/resources/thynkpdf-server/thynkpdf-server \
      python -m pytest -q -p no:cacheprovider packages/backend-tests/audit
Each test names the finding ID it guards (docs/audit/backend-desktop-audit.md)."""
import io, os, sqlite3, sys, tempfile
from pathlib import Path
import pytest, pikepdf, pymupdf
ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / "tools/audit"))
CORPUS = ROOT / "tools/audit/corpus"
SIDECAR = os.getenv("THYNKPDF_AUDIT_SIDECAR")
if not (CORPUS / "std_text.pdf").exists():
    pytest.skip("run tools/audit/make_corpus.py first", allow_module_level=True)
import thynkpdf_engine as eng
from thynkpdf_engine import edit as E

def _source_paths():
    os.environ.setdefault("THYNKPDF_DATABASE_URL", "sqlite:///" + tempfile.mkdtemp() + "/a.db")
    from thynkpdf_api.main import create_app
    return {r.path for r in create_app().routes}

def test_source_registers_feature_routes():  # baseline for BD-01
    p = _source_paths(); assert {"/pdf/annotations", "/pdf/forms/fill", "/signature-requests", "/folders"} <= p

@pytest.mark.skipif(not SIDECAR, reason="set THYNKPDF_AUDIT_SIDECAR to a packaged thynkpdf-server")
def test_BD01_packaged_sidecar_registers_same_routes_as_source():
    from sidecar import Sidecar
    d = tempfile.mkdtemp(); sc = Sidecar(SIDECAR, d + "/data", home=d).start()
    try: packaged = set(sc.req("GET", "/openapi.json")[1]["paths"])
    finally: sc.stop()
    missing = {x for x in _source_paths() - packaged if not x.startswith(("/docs", "/redoc", "/openapi"))}
    assert not missing, f"{len(missing)} API routes missing from packaged sidecar, e.g. {sorted(missing)[:5]}"

@pytest.mark.skipif(not SIDECAR, reason="set THYNKPDF_AUDIT_SIDECAR")
def test_BD05_sidecar_rejects_foreign_host_header():
    from sidecar import Sidecar
    d = tempfile.mkdtemp(); sc = Sidecar(SIDECAR, d + "/data", home=d).start()
    try: st = sc.req("GET", "/health", headers={"Host": "attacker.example"})[0]
    finally: sc.stop()
    assert st in (400, 421), f"foreign Host accepted with {st} (DNS-rebinding precondition)"

@pytest.mark.skipif(not SIDECAR, reason="set THYNKPDF_AUDIT_SIDECAR")
def test_BD04_desktop_db_is_migration_managed():
    from sidecar import Sidecar
    d = tempfile.mkdtemp(); sc = Sidecar(SIDECAR, d + "/data", home=d).start(); sc.stop()
    con = sqlite3.connect(Path(d) / "data/thynkpdf.db")
    assert con.execute("select 1 from sqlite_master where name='alembic_version'").fetchone(), "desktop DB created by create_all only"

def _words(b): return {w[4]: (round(w[0]), round(w[1])) for w in pymupdf.open(stream=b, filetype="pdf")[0].get_text("words")}

def test_BD08_move_text_does_not_shift_following_run():
    d = (CORPUS / "two_runs.pdf").read_bytes(); out, _ = E.move_text(d, 1, "Alpha", 0, 50)
    assert _words(out)["Beta"] == _words(d)["Beta"]

def test_BD09_duplicate_page_keeps_annotations():
    d = (CORPUS / "annots_links_bookmarks_attach_js.pdf").read_bytes(); out = E.duplicate_pages(d, [1])
    p = pikepdf.Pdf.open(io.BytesIO(out)); assert len(p.pages[1].obj.get("/Annots", [])) == len(p.pages[0].obj.get("/Annots", [])) > 0

@pytest.mark.parametrize("op", ["reorder", "extract", "merge"])
def test_BD10_page_ops_keep_document_level_structures(op):
    rich = (CORPUS / "annots_links_bookmarks_attach_js.pdf").read_bytes()
    out = {"reorder": lambda: eng.reorder(rich, [3, 1, 2]), "extract": lambda: eng.extract(rich, [1, 2, 3]),
           "merge": lambda: eng.merge([rich, (CORPUS / "std_text.pdf").read_bytes()])}[op]()
    p = pikepdf.Pdf.open(io.BytesIO(out)); toc = pymupdf.open(stream=out, filetype="pdf").get_toc()
    assert toc and len(p.attachments) >= 1, f"{op}: outline={len(toc)} attachments={len(p.attachments)}"

def test_BD10b_reorder_keeps_acroform():
    out = eng.reorder((CORPUS / "acroform.pdf").read_bytes(), [1])
    p = pikepdf.Pdf.open(io.BytesIO(out)); assert "/AcroForm" in p.Root and len(p.Root.AcroForm.Fields) == 3

def test_compress_never_grows_file():  # verified-working guard
    for n in ["std_text.pdf", "image_heavy.pdf"]:
        d = (CORPUS / n).read_bytes()
        for pr in ["low", "balanced", "high"]: assert len(eng.compress(d, pr)[0]) <= len(d)

def test_signed_doc_detected_and_edit_invalidates():  # guard for API-level DOCUMENT_SIGNED block
    from thynkpdf_signatures import generate_dev_cert, Signer, verify
    cp, kp = generate_dev_cert(tempfile.mkdtemp()); s = Signer(cp, kp).sign((CORPUS / "std_text.pdf").read_bytes())
    assert eng.inspect(s)["has_signatures"] and verify(s)[0]["intact"]
    assert not verify(eng.rotate(s, [1], 90))[0]["intact"]

def test_xfa_xxe_rejected():
    with pytest.raises(eng.EngineError) as e: eng.xfa.read_data((CORPUS / "xfa_xxe.pdf").read_bytes())
    assert e.value.code == "XFA_UNSAFE_XML"
