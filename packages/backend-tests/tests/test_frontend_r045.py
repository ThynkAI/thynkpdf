"""R4.5 rotated-page stamps, R5.6 typed SignerLink, R0.3 defaulted fields not required."""
import io, math
import pikepdf, pytest
from pypdf import PdfReader
from conftest import upload, FIX
from test_signing_audit import png, mk_request


def rotated(deg):
    pdf = pikepdf.open(FIX / "simple-1page.pdf"); pdf.pages[0].Rotate = deg
    b = io.BytesIO(); pdf.save(b); return b.getvalue()


def image_cm(b):
    pdf = pikepdf.open(io.BytesIO(b)); last = None
    for ops, op in pikepdf.parse_content_stream(pdf.pages[0]):
        if str(op) == "cm": last = [float(v) for v in ops]
        if str(op) == "Do" and str(ops[0]).startswith("/TSig"): return last


def text_angle(b, needle):
    out = []
    def v(text, cm, tm, fd, fs):
        if needle in text: out.append(round(math.degrees(math.atan2(tm[1], tm[0]))) % 360)
    PdfReader(io.BytesIO(b)).pages[0].extract_text(visitor_text=v, orientations=(0, 90, 180, 270)); return out


@pytest.mark.parametrize("deg", [0, 90, 180, 270])
def test_stamp_counter_rotates_on_rotated_pages(client, orgA, deg):
    doc = upload(client, orgA, f"rot{deg}.pdf", rotated(deg)).json()["document_id"]
    a1 = client.post("/signatures/assets", headers=orgA, files={"file": ("s.png", png(120, 40), "image/png")}).json()["asset_id"]
    a2 = client.post("/signatures/assets", headers=orgA, json={"kind": "typed", "text": "Deep Kanabar", "font": "Times-Italic"}).json()["asset_id"]
    rect = [100, 100, 300, 300]
    r = client.post("/pdf/signatures/place", headers=orgA, json={"document_id": doc, "expected_version": 1, "placements": [
        {"asset_id": a1, "page": 1, "rect": rect}, {"asset_id": a2, "page": 1, "rect": [320, 100, 400, 400] if deg in (90, 270) else [320, 100, 560, 160]}]})
    assert r.status_code == 200, r.text
    b = client.get(f"/documents/{doc}/download", headers=orgA).content
    a, bb, c, d, e, f = image_cm(b)
    assert round(math.degrees(math.atan2(bb, a))) % 360 == deg          # image x-axis rotated by /Rotate (ccw) => upright on screen
    corners = [(e + a * x + c * y, f + bb * x + d * y) for x in (0, 1) for y in (0, 1)]
    xs, ys = [p[0] for p in corners], [p[1] for p in corners]
    assert min(xs) >= rect[0] - 1e-6 and max(xs) <= rect[2] + 1e-6 and min(ys) >= rect[1] - 1e-6 and max(ys) <= rect[3] + 1e-6
    # displayed aspect stays 3:1 (wide), i.e. the long side runs along the displayed horizontal
    w_disp = math.hypot(a, bb); h_disp = math.hypot(c, d); assert abs(w_disp / h_disp - 3) < 1e-6
    assert text_angle(b, "Deep Kanabar") == [deg]


def test_signer_completion_on_rotated_page(client, orgA):
    doc = upload(client, orgA, "rot90.pdf", rotated(90)).json()["document_id"]
    req = mk_request(client, orgA, doc, ordered=False)
    for link in req["signer_links"]:
        fs = client.get(link["path"]).json()["fields"]
        r = client.post(f"{link['path']}/complete", json={"consent": True, "placements": [{"field_id": x["field_id"], "text": "Signer X"} for x in fs]})
        assert r.status_code == 200, r.text
    b = client.get(f"/documents/{doc}/download", headers=orgA).content
    assert set(text_angle(b, "Signer X")) == {90}


def test_openapi_signer_link_and_optional_defaults(client):
    spec = client.get("/openapi.json").json(); sc = spec["components"]["schemas"]
    assert sc["SignerLink"]["required"] == ["signer_index", "email", "token", "path"]
    assert sc["CreatedReqOut"]["properties"]["signer_links"]["items"]["$ref"].endswith("/SignerLink")
    bad = {k: [p for p in v.get("required", []) if "default" in v.get("properties", {}).get(p, {})] for k, v in sc.items()}
    assert {k: v for k, v in bad.items() if v} == {}
    assert "font_size" not in sc["FieldSpec"].get("required", []) and "font" not in sc["EditOp"].get("required", [])
