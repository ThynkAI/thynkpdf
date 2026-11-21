"""True redaction: content under marks must be GONE from the file (text, vector art, image pixels), not covered."""
import io, subprocess, sys
from pathlib import Path
import pikepdf, pytest
from pikepdf import PdfImage
from pypdf import PdfReader
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import redact_fixture as F  # noqa: E402
from conftest import upload  # noqa: E402
import thynkpdf_engine as eng  # noqa: E402

R = eng.redaction
H_PAGE = 792


@pytest.fixture(scope="module")
def sample(): return F.build()


_KEEP = []


def _keep(pdf: bytes):
    """Open and keep a reference (pikepdf objects die with their Pdf)."""
    p = pikepdf.open(io.BytesIO(pdf)); _KEEP.append(p); return p


def region_text(pdf: bytes, page: int, rect) -> str:
    """Text poppler extracts from a region (PDF user-space rect -> pdftotext top-left crop)."""
    x0, y0, x1, y1 = rect
    r = subprocess.run(["pdftotext", "-f", str(page), "-l", str(page), "-x", str(int(x0)), "-y", str(int(H_PAGE - y1)),
                        "-W", str(int(x1 - x0) + 1), "-H", str(int(y1 - y0) + 1), "-", "-"], input=pdf, capture_output=True, check=True)
    return r.stdout.decode().strip()


def all_text(pdf: bytes, page: int | None = None) -> str:
    pg = ["-f", str(page), "-l", str(page)] if page else []
    return subprocess.run(["pdftotext", *pg, "-", "-"], input=pdf, capture_output=True, check=True).stdout.decode()


def pypdf_text(pdf: bytes) -> str:
    return "\n".join(p.extract_text() or "" for p in PdfReader(io.BytesIO(pdf)).pages)


def raw_has(pdf: bytes, s: str) -> bool:
    """Search every decoded stream + the raw file for the literal (catches text left in content streams)."""
    p = pikepdf.open(io.BytesIO(pdf)); b = s.encode()
    for o in p.objects:
        if isinstance(o, pikepdf.Stream):
            try:
                if b in o.read_bytes(): return True
            except Exception: pass
    return b in pdf


def word_box(pdf: bytes, word: str, page=1):
    out = subprocess.run(["pdftotext", "-bbox", "-f", str(page), "-l", str(page), "-", "-"], input=pdf, capture_output=True, check=True).stdout.decode()
    import re
    for m in re.finditer(r'xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)">([^<]*)<', out):
        if m.group(5) == word: return tuple(round(float(m.group(i)), 1) for i in range(1, 5))
    return None


def marks_for(data, query, **kw):
    res = R.search_text(data, query, **kw)
    return [{"page": m["page"], "rect": r} for m in res["matches"] for r in m["rects"]], res


# ------------------------------------------------------------------ search
def test_search_finds_text_and_patterns(sample):
    res = R.search_text(sample, F.SECRET)
    assert [m["page"] for m in res["matches"]] == [1, 2]
    x0, y0, x1, y1 = res["matches"][0]["rects"][0]
    assert 200 < x0 < 215 and 360 < x1 < 370 and 690 < y0 < 700 < y1 < 712
    pats = R.search_text(sample, None, patterns=["email", "phone"])["matches"]
    assert {(m["kind"], m["text"]) for m in pats} == {("email", F.EMAIL), ("phone", F.PHONE)}
    assert R.search_text(sample, "secret-account", case_sensitive=True)["count"] == 0
    assert R.search_text(sample, "secret-account")["count"] == 2
    assert R.search_text(sample, r"ACCOUNT-\d+", regex=True)["count"] == 2


def test_search_rejects_bad_or_dangerous_regex(sample):
    with pytest.raises(eng.EngineError) as e: R.search_text(sample, "(a+)+$", regex=True)
    assert e.value.code == "REGEX_TOO_COMPLEX"
    with pytest.raises(eng.EngineError) as e: R.search_text(sample, "([", regex=True)
    assert e.value.code == "INVALID_REGEX"


def test_credit_card_requires_luhn():
    assert R._luhn("4111 1111 1111 1111") and not R._luhn("4111 1111 1111 1112")


# ------------------------------------------------------------------ text removal
def test_redacted_text_is_removed_not_covered(sample):
    marks, res = marks_for(sample, F.SECRET)
    before_end = word_box(sample, "end.")
    out, rep = R.redact(sample, marks)
    assert rep["glyphs_removed"] == 2 * len(F.SECRET)
    rect = res["matches"][0]["rects"][0]
    assert F.SECRET not in all_text(out) and F.SECRET not in pypdf_text(out)
    assert region_text(out, 1, rect) == "" and region_text(sample, 1, rect) == F.SECRET
    assert raw_has(sample, "778899") and not raw_has(out, "778899")
    # neighbours keep their text AND position (removed glyphs are replaced by an equal TJ displacement)
    t = all_text(out)
    assert "Public intro line. Account:" in t and "end." in t and "This line must stay readable after redaction." in t
    assert word_box(out, "end.") == before_end


def test_partial_word_area_redaction(sample):
    # draw a box over only "778899" of the account number
    full = R.search_text(sample, F.SECRET)["matches"][0]["rects"][0]
    part = R.search_text(sample, "778899")["matches"][0]["rects"][0]
    out, _ = R.redact(sample, [{"page": 1, "rect": part}])
    t = all_text(out, 1)
    assert "SECRET-ACCOUNT-" in t and "778899" not in t
    assert region_text(out, 1, full) == "SECRET-ACCOUNT-"


@pytest.mark.skipif(F.TTF is None, reason="DejaVu font not installed")
def test_embedded_cid_font_text_removed(sample):
    marks, res = marks_for(sample, "Geheimnis 4242")
    assert res["count"] == 1
    out, rep = R.redact(sample, marks)
    t = all_text(out)
    assert "Geheimnis" not in t and "4242" not in t and "Embedded:" in t and "done" in t


# ------------------------------------------------------------------ images + vector graphics
def _images(pdf: bytes, page=1):
    p = pikepdf.open(io.BytesIO(pdf)); pg = p.pages[page - 1]
    return [PdfImage(v).as_pil_image().convert("RGB") for k, v in pg.images.items()]


def test_image_pixels_under_mark_are_overwritten(sample):
    x0, y0, x1, y1 = F.IMG_RECT  # 200x200 px image drawn at 200x200 pt
    rect = [350, 450, 450, 550]  # centre quarter of the image
    orig = _images(sample)[0]
    out, rep = R.redact(sample, [{"page": 1, "rect": rect}])
    assert rep["images_redacted"] == 1
    imgs = _images(out); assert len(imgs) == 1
    im = imgs[0]; assert im.size == orig.size
    # pixel (100,100) is under the mark (image row 0 = top): black now, was coloured
    assert im.getpixel((100, 100)) == (0, 0, 0) and orig.getpixel((100, 100)) != (0, 0, 0)
    assert im.getpixel((10, 10)) == orig.getpixel((10, 10))  # outside the mark: untouched
    # the original (unredacted) image object is no longer in the file at all
    p = pikepdf.open(io.BytesIO(out))
    for o in p.objects:
        if isinstance(o, pikepdf.Stream) and o.get("/Subtype") == "/Image" and o.get("/Width") == 200:
            assert PdfImage(o).as_pil_image().convert("RGB").getpixel((100, 100)) == (0, 0, 0)


def test_image_fully_covered_is_removed(sample):
    x0, y0, x1, y1 = F.IMG_RECT
    out, rep = R.redact(sample, [{"page": 1, "rect": [x0 - 1, y0 - 1, x1 + 1, y1 + 1]}])
    assert rep["images_removed"] == 1 and _images(out) == []


def test_line_art_touching_mark_removed_background_kept(sample):
    out, rep = R.redact(sample, [{"page": 1, "rect": [100, 550, 150, 570]}, {"page": 1, "rect": [100, 505, 120, 525]}])
    assert rep["paths_removed"] == 1  # the 2pt line crossing the first mark; the grey box containing the 2nd mark stays
    ops = pikepdf.unparse_content_stream(pikepdf.parse_content_stream(_keep(out).pages[0]))
    assert b"560 m" not in ops and b"250 560 l" not in ops and b"60 500 240 30 re" in ops


def test_list_images(sample):
    assert R.list_images(sample) == [{"page": 1, "rect": [300.0, 400.0, 500.0, 600.0], "width": 200, "height": 200, "inline": False}]


# ------------------------------------------------------------------ page-level
def test_whole_page_redaction(sample):
    out, rep = R.redact(sample, [{"page": 2, "whole_page": True}])
    p = pikepdf.open(io.BytesIO(out))
    assert len(p.pages) == 2 and not R.search_text(out, F.SECRET, pages=[2])["matches"]
    assert dict(p.pages[1].obj.Resources) == {} and "/Annots" not in p.pages[1].obj
    assert F.SECRET in all_text(out)  # page 1 untouched


def test_fill_none_removes_without_box(sample):
    marks, _ = marks_for(sample, F.SECRET)
    out, _ = R.redact(sample, marks, fill_rgb=None)
    assert F.SECRET not in all_text(out)
    assert b" re f" not in _keep(out).pages[1].obj.Contents.read_bytes()


def test_black_fill_box_drawn(sample):
    marks, _ = marks_for(sample, F.SECRET)
    out, _ = R.redact(sample, marks)
    tail = _keep(out).pages[1].obj.Contents.read_bytes()
    assert b"0.0000 0.0000 0.0000 rg" in tail and b"re f" in tail


def test_overlapping_annotation_removed(sample):
    out, rep = R.redact(sample, [{"page": 1, "rect": [70, 688, 95, 712]}])
    assert rep["annotations_removed"] == 1 and "/Annots" not in _keep(out).pages[0].obj


def test_invalid_marks():
    with pytest.raises(eng.EngineError): R.redact(F.build(), [{"page": 9, "rect": [0, 0, 10, 10]}])
    with pytest.raises(eng.EngineError): R.redact(F.build(), [{"page": 1, "rect": [0, 0, 0, 10]}])


# ------------------------------------------------------------------ structures: forms, inline images, ActualText
def _form_pdf() -> bytes:
    p = pikepdf.new(); p.add_blank_page(page_size=(612, 792)); pg = p.pages[0]
    font = p.make_indirect(pikepdf.Dictionary(Type=pikepdf.Name.Font, Subtype=pikepdf.Name.Type1, BaseFont=pikepdf.Name.Helvetica))
    form = p.make_stream(b"BT /F1 12 Tf 0 0 Td (FORMSECRET 1234) Tj ET")
    form.Type = pikepdf.Name.XObject; form.Subtype = pikepdf.Name.Form; form.BBox = [0, -5, 200, 20]
    form.Resources = pikepdf.Dictionary(Font=pikepdf.Dictionary(F1=font))
    form = p.make_indirect(form)
    pg.obj.Resources = pikepdf.Dictionary(XObject=pikepdf.Dictionary(Fx=form), Font=pikepdf.Dictionary(F1=font))
    pg.obj.Contents = p.make_stream(
        b"q 1 0 0 1 100 700 cm /Fx Do Q q 1 0 0 1 100 500 cm /Fx Do Q\n"
        b"/Span <</ActualText (ALT-SECRET)>> BDC BT /F1 12 Tf 100 300 Td (VISIBLE-ALT) Tj ET EMC\n"
        b"q 50 0 0 50 300 100 cm BI /W 2 /H 2 /BPC 8 /CS /G ID \x10\x20\x30\x40 EI Q")
    b = io.BytesIO(); p.save(b); return b.getvalue()


def test_form_xobject_text_redacted_only_where_marked():
    data = _form_pdf()
    res = R.search_text(data, "FORMSECRET")
    assert res["count"] == 2
    top = [m for m in res["matches"] if m["rects"][0][1] > 600][0]
    out, rep = R.redact(data, [{"page": 1, "rect": top["rects"][0]}])
    t = all_text(out)
    assert t.count("FORMSECRET") == 1  # the second placement (not marked) is intact
    assert rep["glyphs_removed"] == len("FORMSECRET")


def test_inline_image_and_actualtext_removed():
    data = _form_pdf()
    out, rep = R.redact(data, [{"page": 1, "rect": [310, 110, 320, 120]}, {"page": 1, "rect": [95, 295, 200, 315]}])
    assert rep["inline_images_removed"] == 1 and rep["actual_text_removed"] == 1
    body = _keep(out).pages[0].obj.Contents.read_bytes()
    assert b"ALT-SECRET" not in body and b"BI" not in body and b"VISIBLE-ALT" not in body


# ------------------------------------------------------------------ remove hidden information
def test_sanitize_removes_hidden_information(sample):
    assert F.HIDDEN in all_text(sample)
    out, rep = R.sanitize(sample)
    p = pikepdf.open(io.BytesIO(out))
    assert F.HIDDEN not in all_text(out) and rep["invisible_glyphs_removed"] == len(F.HIDDEN)
    assert len(p.docinfo.keys()) == 0 and "/Metadata" not in p.Root
    assert "/OpenAction" not in p.Root and not p.attachments
    assert "/Annots" not in p.pages[0].obj
    assert b"app.alert" not in out and b"attached secret" not in out
    assert "Public intro line" in all_text(out)  # visible text kept


def test_redact_with_sanitize_and_fullrewrite(sample):
    marks, _ = marks_for(sample, F.EMAIL)
    out, rep = R.redact(sample, marks, sanitize_opts={"metadata": True, "javascript": True, "attachments": False, "comments": False, "forms": True, "hidden_text": False})
    p = pikepdf.open(io.BytesIO(out))
    assert F.EMAIL not in all_text(out) and "/OpenAction" not in p.Root and p.attachments
    assert "Jane Doe" not in str(p.docinfo)


# ------------------------------------------------------------------ API
def _doc(client, orgA, data):
    r = upload(client, orgA, "sample.pdf", data); assert r.status_code == 201, r.text; return r.json()


def test_api_search_images_apply_new_document(client, orgA, sample):
    d = _doc(client, orgA, sample)
    r = client.post("/pdf/redact/search", headers=orgA, json={"document_id": d["document_id"], "query": F.SECRET, "patterns": ["email"]})
    assert r.status_code == 200, r.text
    ms = r.json()["matches"]; assert {m["kind"] for m in ms} == {"query", "email"}
    im = client.post("/pdf/redact/images", headers=orgA, json={"document_id": d["document_id"]}).json()["images"]
    assert im[0]["page"] == 1
    marks = [{"page": m["page"], "rect": rc} for m in ms for rc in m["rects"]] + [{"page": 1, "rect": im[0]["rect"]}]
    body = {"document_id": d["document_id"], "expected_version": 1, "marks": marks}
    assert client.post("/pdf/redact/apply", headers=orgA, json=body).json()["error"]["code"] == "CONFIRMATION_REQUIRED"
    r = client.post("/pdf/redact/apply", headers=orgA, json={**body, "confirm": True, "sanitize": {}})
    assert r.status_code == 200, r.text
    v = r.json(); assert v["document_id"] != d["document_id"] and v["filename"] == "sample-redacted.pdf" and v["version"] == 1
    assert v["report"]["glyphs_removed"] > 0 and v["report"]["images_removed"] == 1 and v["report"]["sanitized"]
    red = client.get(f"/documents/{v['document_id']}/download", headers=orgA).content
    orig = client.get(f"/documents/{d['document_id']}/download", headers=orgA).content
    assert F.SECRET not in all_text(red) and F.EMAIL not in all_text(red) and F.HIDDEN not in all_text(red)
    assert F.SECRET in all_text(orig)  # the source document is untouched
    audit = client.get(f"/documents/{v['document_id']}/versions", headers=orgA).json()
    assert audit[0]["operation"] == "redact" and F.SECRET not in str(audit)


def test_api_new_version_and_conflict(client, orgA, sample):
    d = _doc(client, orgA, sample)
    marks = [{"page": 2, "whole_page": True}]
    r = client.post("/pdf/redact/apply", headers=orgA, json={"document_id": d["document_id"], "expected_version": 1, "marks": marks, "confirm": True, "output": "new_version", "fill": "none"})
    assert r.status_code == 200 and r.json()["version"] == 2 and r.json()["document_id"] == d["document_id"]
    r = client.post("/pdf/redact/apply", headers=orgA, json={"document_id": d["document_id"], "expected_version": 1, "marks": marks, "confirm": True})
    assert r.status_code == 409 and r.json()["error"]["code"] == "VERSION_CONFLICT"


def test_api_validation_and_isolation(client, orgA, orgB, sample):
    d = _doc(client, orgA, sample)
    j = {"document_id": d["document_id"], "expected_version": 1, "confirm": True}
    assert client.post("/pdf/redact/apply", headers=orgA, json={**j, "marks": []}).status_code == 422
    assert client.post("/pdf/redact/apply", headers=orgA, json={**j, "marks": [{"page": 1}]}).status_code == 422
    assert client.post("/pdf/redact/apply", headers=orgB, json={**j, "marks": [{"page": 1, "whole_page": True}]}).status_code == 404
    assert client.post("/pdf/redact/search", headers=orgB, json={"document_id": d["document_id"], "query": "x"}).status_code == 404


def test_rotated_image_pixels_mapped_through_ctm():
    from PIL import Image
    p = pikepdf.new(); p.add_blank_page(page_size=(612, 792))
    im = Image.new("RGB", (100, 50), (200, 30, 30))
    img = pikepdf.Stream(p, im.tobytes()); img.Type = pikepdf.Name.XObject; img.Subtype = pikepdf.Name.Image
    img.Width, img.Height, img.ColorSpace, img.BitsPerComponent = 100, 50, pikepdf.Name.DeviceRGB, 8
    pg = p.pages[0]; pg.obj.Resources = pikepdf.Dictionary(XObject=pikepdf.Dictionary(Im=p.make_indirect(img)))
    pg.obj.Contents = p.make_stream(b"q 0 50 -100 0 300 300 cm /Im Do Q")  # rotated 90 deg, drawn in x 200..300, y 300..350
    b = io.BytesIO(); p.save(b); data = b.getvalue()
    assert R.list_images(data)[0]["rect"] == [200.0, 300.0, 300.0, 350.0]
    out, rep = R.redact(data, [{"page": 1, "rect": [245, 320, 255, 330]}])
    assert rep["images_redacted"] == 1
    got = _images(out)[0]
    assert got.getpixel((50, 25)) == (0, 0, 0) and got.getpixel((5, 5)) == (200, 30, 30) and got.getpixel((95, 45)) == (200, 30, 30)
