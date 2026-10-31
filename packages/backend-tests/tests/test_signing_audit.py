import io
from pypdf import PdfReader
from conftest import upload, pdftotext
import thynkpdf_signatures as sigs

def png(w=120, h=40):
    from PIL import Image, ImageDraw
    im = Image.new("RGBA", (w, h), (255, 255, 255, 0)); ImageDraw.Draw(im).line((5, 30, 60, 5, 115, 30), fill=(0, 0, 160, 255), width=3)
    b = io.BytesIO(); im.save(b, "PNG"); return b.getvalue()

def mk_request(client, h, doc, ordered=True):
    r = client.post("/signature-requests", headers=h, json={"document_id": doc, "version": 1, "message": "Please sign",
        "signers": [{"email": "alice@signer.example.com", "name": "Alice Doe", **({"order": 1} if ordered else {})},
                    {"email": "bob@signer.example.com", "name": "Bob Roe", **({"order": 2} if ordered else {})}],
        "fields": [{"signer_index": 0, "page": 1, "rect": [72, 100, 272, 140], "type": "signature"},
                   {"signer_index": 0, "page": 1, "rect": [72, 60, 172, 80], "type": "date"},
                   {"signer_index": 1, "page": 1, "rect": [320, 100, 520, 140], "type": "signature"},
                   {"signer_index": 1, "page": 1, "rect": [320, 60, 420, 80], "type": "initials"}]})
    assert r.status_code == 201, r.text; return r.json()

def test_signature_assets_and_place(client, orgA, orgB):
    import base64
    a1 = client.post("/signatures/assets", headers=orgA, files={"file": ("sig.png", png(), "image/png")}); assert a1.status_code == 201, a1.text
    a2 = client.post("/signatures/assets", headers=orgA, json={"kind": "typed", "text": "Deep Kanabar", "font": "Times-Italic"}); assert a2.status_code == 201, a2.text
    assert client.post("/signatures/assets", headers=orgA, files={"file": ("s.svg", b"<svg onload='x'/>", "image/svg+xml")}).json()["error"]["code"] == "SVG_NOT_SUPPORTED"
    assert client.post("/signatures/assets", headers=orgA, files={"file": ("big.png", b"\x89PNG\r\n\x1a\n" + b"0" * 1_000_100, "image/png")}).json()["error"]["code"] == "FILE_TOO_LARGE"
    assert client.post("/signatures/assets", headers=orgA, files={"file": ("x.png", b"GIF89a....", "image/png")}).json()["error"]["code"] == "INVALID_FILE_TYPE"
    ids = [a1.json()["asset_id"], a2.json()["asset_id"]]
    assert [a["asset_id"] for a in client.get("/signatures/assets", headers=orgA).json()] == ids
    assert client.get(f"/signatures/assets/{ids[0]}/image", headers=orgA).content[:4] == b"\x89PNG"
    assert client.get(f"/signatures/assets/{ids[1]}/image", headers=orgA).headers["content-type"] == "image/png"
    assert client.get(f"/signatures/assets/{ids[0]}/image", headers=orgB).status_code == 404
    doc = upload(client, orgA, "simple-1page.pdf").json()["document_id"]
    r = client.post("/pdf/signatures/place", headers=orgA, json={"document_id": doc, "expected_version": 1, "placements": [
        {"asset_id": ids[0], "page": 1, "rect": [72, 100, 272, 160]}, {"asset_id": ids[1], "page": 1, "rect": [300, 100, 500, 140]}]})
    assert r.status_code == 200, r.text and r.json()["report"]["visual_only"]
    b = client.get(f"/documents/{doc}/download", headers=orgA).content
    pg = PdfReader(io.BytesIO(b)).pages[0]
    assert len(pg.images) == 1 and "Deep Kanabar" in pdftotext(b)
    assert client.post("/pdf/signatures/place", headers=orgB, json={"document_id": doc, "expected_version": 2, "placements": [{"asset_id": ids[0], "page": 1, "rect": [1, 1, 50, 50]}]}).status_code == 404
    bdoc = upload(client, orgB, "simple-1page.pdf").json()["document_id"]
    assert client.post("/pdf/signatures/place", headers=orgB, json={"document_id": bdoc, "expected_version": 1, "placements": [{"asset_id": ids[0], "page": 1, "rect": [1, 1, 50, 50]}]}).json()["error"]["code"] == "ASSET_NOT_FOUND"
    assert client.delete(f"/signatures/assets/{ids[0]}", headers=orgA).status_code == 204
    assert len(client.get("/signatures/assets", headers=orgA).json()) == 1
    au = client.get(f"/documents/{doc}/audit", headers=orgA).json()
    assert {"upload", "sign", "signature_place", "view"} <= {x["action"] for x in au} and all(x["actor_email"] == "a@orga.example.com" for x in au)

def test_signature_request_flow(client, orgA):
    import base64
    doc = upload(client, orgA, "simple-1page.pdf").json()["document_id"]
    req = mk_request(client, orgA, doc); rid = req["request_id"]; assert req["status"] == "pending"
    ta, tb = (x["token"] for x in req["signer_links"])
    assert "token" not in str(client.get(f"/signature-requests/{rid}", headers=orgA).json()).replace("signer_links", "")
    assert client.get("/sign/bogus").json()["error"]["code"] == "SIGNER_TOKEN_INVALID"
    sb = client.get(f"/sign/{tb}").json(); assert sb["can_sign"] is False and sb["blocked_reason"] == "waiting_for_previous_signers"
    sa = client.get(f"/sign/{ta}").json(); assert sa["can_sign"] and len(sa["fields"]) == 2
    assert client.get(f"/sign/{ta}/document").content[:5] == b"%PDF-"
    fa = {f["type"]: f["field_id"] for f in sa["fields"]}
    assert client.post(f"/sign/{tb}/complete", json={"consent": True, "placements": [{"field_id": "x", "text": "B"}]}).json()["error"]["details"]["reason"] == "waiting_for_previous_signers"
    assert client.post(f"/sign/{ta}/complete", json={"consent": False, "placements": [{"field_id": fa["signature"], "text": "Alice Doe"}]}).json()["error"]["code"] == "CONSENT_REQUIRED"
    r = client.post(f"/sign/{ta}/complete", json={"consent": True, "placements": [{"field_id": fa["signature"], "image_base64": base64.b64encode(png()).decode()}]})
    assert r.status_code == 200, r.text and r.json()["status"] == "pending"
    assert client.post(f"/sign/{ta}/complete", json={"consent": True, "placements": [{"field_id": fa["signature"], "text": "x"}]}).json()["error"]["code"] == "SIGNING_NOT_ALLOWED"
    assert client.post(f"/signature-requests/{rid}/remind", headers=orgA).json() == {"queued": ["bob@signer.example.com"], "delivered": False, "note": "No email provider configured (BLOCKED); reminder recorded only."}
    fb = {f["type"]: f["field_id"] for f in client.get(f"/sign/{tb}").json()["fields"]}
    r = client.post(f"/sign/{tb}/complete", json={"consent": True, "placements": [{"field_id": fb["signature"], "text": "Bob Roe"}]})
    assert r.json()["error"]["code"] == "VALIDATION_ERROR"  # initials missing
    r = client.post(f"/sign/{tb}/complete", json={"consent": True, "placements": [{"field_id": fb["signature"], "text": "Bob Roe"}, {"field_id": fb["initials"], "text": "BR"}]})
    assert r.status_code == 200, r.text
    out = r.json(); assert out["status"] == "completed" and out["chain_valid"] and out["final_version_id"]
    final = client.get(f"/documents/{doc}/download", headers=orgA).content
    t = pdftotext(final); assert "Bob Roe" in t and "BR" in t and "Electronic Signature Certificate" in t
    rd = PdfReader(io.BytesIO(final)); assert len(rd.pages) == 2 and len(rd.pages[0].images) == 1
    import datetime; assert datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%d") in t  # auto date field
    st = client.get(f"/pdf/{doc}/signatures", headers=orgA).json()["signatures"]
    assert st[0]["intact"] and st[0]["crypto_valid"] and st[0]["trusted"] is False and st[0]["modified_after_signing"] is False
    assert client.post("/pdf/pages/rotate", headers=orgA, json={"document_id": doc, "expected_version": 2, "angle": 90}).json()["error"]["code"] == "DOCUMENT_SIGNED"
    lst = client.get(f"/signature-requests?document_id={doc}", headers=orgA).json(); assert [x["request_id"] for x in lst] == [rid]
    au = {(x["action"], x["actor_email"]) for x in client.get(f"/documents/{doc}/audit", headers=orgA).json()}
    assert ("request_sent", "a@orga.example.com") in au and ("sign", "alice@signer.example.com") in au and ("view", "bob@signer.example.com") in au and ("completed", "system") in au

def test_event_chain_tamper_detected(client, orgA):
    doc = upload(client, orgA, "simple-1page.pdf").json()["document_id"]
    rid = mk_request(client, orgA, doc)["request_id"]
    from thynkpdf_api.db import SigningEvent
    with client.app.state.sessions() as s:
        e = s.query(SigningEvent).filter_by(request_id=rid, seq=2).one(); e.data = '{"email":"mallory@evil.example.com"}'; s.commit()
    ev = client.get(f"/signature-requests/{rid}/events", headers=orgA).json()
    assert ev["chain_valid"] is False and ev["first_invalid_seq"] == 2
    assert client.get(f"/signature-requests/{rid}", headers=orgA).json()["chain_valid"] is False

def test_decline_cancel_and_conflict(client, orgA):
    doc = upload(client, orgA, "simple-1page.pdf").json()["document_id"]
    req = mk_request(client, orgA, doc, ordered=False)
    assert client.post(f"/sign/{req['signer_links'][1]['token']}/decline", json={"reason": "no"}).json()["status"] == "declined"
    doc2 = upload(client, orgA, "simple-1page.pdf").json()["document_id"]
    req2 = mk_request(client, orgA, doc2)
    assert client.post(f"/signature-requests/{req2['request_id']}/cancel", headers=orgA).json()["status"] == "cancelled"
    assert client.get(f"/sign/{req2['signer_links'][0]['token']}").json()["blocked_reason"] == "request_cancelled"
    doc3 = upload(client, orgA, "simple-1page.pdf").json()["document_id"]
    req3 = mk_request(client, orgA, doc3, ordered=False)
    client.post("/pdf/pages/rotate", headers=orgA, json={"document_id": doc3, "expected_version": 1, "angle": 90})
    for i, link in enumerate(req3["signer_links"]):
        fs = client.get(f"/sign/{link['token']}").json()["fields"]
        r = client.post(f"/sign/{link['token']}/complete", json={"consent": True, "placements": [{"field_id": f["field_id"], "text": "X"} for f in fs]})
    assert r.json()["status"] == "needs_attention"
    assert client.post("/signature-requests", headers=orgA, json={"document_id": doc3, "version": 1, "signers": [{"email": "z@z.example.com", "name": "Z"}],
        "fields": [{"signer_index": 0, "page": 1, "rect": [1, 1, 50, 20], "type": "signature"}]}).json()["error"]["code"] == "VERSION_CONFLICT"

def test_crypto_sign_verify_tamper(client, orgA):
    up = upload(client, orgA, "simple-1page.pdf").json(); doc = up["document_id"]
    cert = client.get("/pdf/signatures/certificate", headers=orgA).json()
    assert cert["dev_untrusted"] and not cert["trusted_identity"] and "UNTRUSTED" in cert["subject"] and "key" not in str(cert).lower().replace("monkey", "")
    r = client.post("/pdf/signatures/sign", headers=orgA, json={"document_id": doc, "expected_version": 1, "reason": "approve", "page": 1, "rect": [300, 50, 500, 90]})
    assert r.status_code == 200, r.text and r.json()["report"]["warnings"]
    signed = client.get(f"/documents/{doc}/download", headers=orgA).content
    st = sigs.verify(signed)[0]; assert st["intact"] and st["crypto_valid"] and not st["trusted"]  # independent call
    # multi-signature: second incremental signature keeps first intact
    r = client.post("/pdf/signatures/sign", headers=orgA, json={"document_id": doc, "expected_version": 2, "field_name": "Second"}); assert r.status_code == 200
    vs = client.get(f"/pdf/{doc}/signatures", headers=orgA).json()["signatures"]
    assert len(vs) == 2 and all(x["intact"] for x in vs) and vs[0]["modified_after_signing"] is True and vs[1]["modified_after_signing"] is False
    tampered = bytearray(signed); i = signed.find(b"Invoice"); tampered[i] = ord("J")
    d2 = upload(client, orgA, "t.pdf", bytes(tampered)).json()["document_id"]
    assert client.get(f"/pdf/{d2}/signatures", headers=orgA).json()["signatures"][0]["intact"] is False

def test_audit_query(client, orgA, orgB):
    upload(client, orgA); upload(client, orgB)
    rows = client.get("/audit?action=document.", headers=orgA).json()
    assert len(rows) == 1 and rows[0]["action"] == "document.upload"
    assert all(r["action"].startswith("auth") for r in client.get("/audit?action=auth", headers=orgA).json())
    client.post("/orgs/members", headers=orgA, json={"email": "m@orga.example.com", "password": "member-pass-1", "role": "member"})
    tm = client.post("/auth/login", json={"email": "m@orga.example.com", "password": "member-pass-1"}).json()["access_token"]
    assert client.get("/audit", headers={"Authorization": f"Bearer {tm}"}).json()["error"]["code"] == "FORBIDDEN_ROLE"

def test_signing_cross_tenant(client, orgA, orgB):
    doc = upload(client, orgA, "simple-1page.pdf").json()["document_id"]
    rid = mk_request(client, orgA, doc)["request_id"]
    for path in [f"/signature-requests/{rid}", f"/signature-requests/{rid}/events", f"/pdf/{doc}/signatures", f"/documents/{doc}/audit"]:
        assert client.get(path, headers=orgB).status_code == 404, path
    for path in [f"/signature-requests/{rid}/cancel", f"/signature-requests/{rid}/remind"]:
        assert client.post(path, headers=orgB).status_code == 404, path
    assert client.get("/signature-requests", headers=orgB).json() == []
    assert client.get(f"/signature-requests?document_id={doc}", headers=orgB).status_code == 404
    assert client.post("/signature-requests", headers=orgB, json={"document_id": doc, "version": 1, "signers": [{"email": "x@x.example.com", "name": "x"}],
        "fields": [{"signer_index": 0, "page": 1, "rect": [1, 1, 2, 2], "type": "signature"}]}).status_code == 404
    assert client.post("/pdf/signatures/sign", headers=orgB, json={"document_id": doc, "expected_version": 1}).status_code == 404
