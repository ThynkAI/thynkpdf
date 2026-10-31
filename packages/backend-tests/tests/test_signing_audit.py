import io
from pypdf import PdfReader
from conftest import upload, pdftotext
import thynkpdf_signatures as sigs

def mk_request(client, h, doc, sequential=True):
    r = client.post("/signing-requests", headers=h, json={"document_id": doc, "expected_version": 1, "title": "NDA", "sequential": sequential,
        "signers": [{"email": "alice@signer.example.com", "name": "Alice Doe", "order": 1, "page": 1, "rect": [72, 100, 272, 140]},
                    {"email": "bob@signer.example.com", "name": "Bob Roe", "order": 2, "page": 1, "rect": [320, 100, 520, 140]}]})
    assert r.status_code == 201, r.text; return r.json()

def T(tok): return {"X-Signer-Token": tok}

def test_esign_workflow_order_consent_chain_final_pdf(client, orgA):
    doc = upload(client, orgA, "simple-1page.pdf").json()["document_id"]
    req = mk_request(client, orgA, doc); rid = req["request_id"]
    ta, tb = (x["signing_token"] for x in req["signers"])
    assert "signing_token" not in str(client.get(f"/signing-requests/{rid}", headers=orgA).json())
    assert client.get("/signing/session", headers=T("bogus")).json()["error"]["code"] == "SIGNER_TOKEN_INVALID"
    sb = client.get("/signing/session", headers=T(tb)).json(); assert sb["can_sign"] is False and sb["blocked_reason"] == "waiting_for_previous_signers"
    assert client.get("/signing/session/document", headers=T(ta)).content[:5] == b"%PDF-"
    assert client.post("/signing/session/sign", headers=T(ta), json={"signature_text": "Alice Doe"}).json()["error"]["code"] == "CONSENT_REQUIRED"
    assert client.post("/signing/session/consent", headers=T(ta), json={"accept": False}).json()["error"]["code"] == "CONSENT_REQUIRED"
    assert client.post("/signing/session/consent", headers=T(ta), json={"accept": True}).status_code == 200
    assert client.post("/signing/session/consent", headers=T(tb), json={"accept": True}).status_code == 200
    assert client.post("/signing/session/sign", headers=T(tb), json={"signature_text": "Bob Roe"}).json()["error"]["details"]["reason"] == "waiting_for_previous_signers"
    assert client.post(f"/signing-requests/{rid}/complete", headers=orgA).json()["error"]["code"] == "SIGNING_INCOMPLETE"
    assert client.post("/signing/session/sign", headers=T(ta), json={"signature_text": "Alice Doe"}).status_code == 200
    assert client.post("/signing/session/sign", headers=T(ta), json={"signature_text": "Alice Doe"}).json()["error"]["code"] == "SIGNING_NOT_ALLOWED"
    assert client.post("/signing/session/sign", headers=T(tb), json={"signature_text": "Bob Roe"}).status_code == 200
    r = client.post(f"/signing-requests/{rid}/complete", headers=orgA); assert r.status_code == 200, r.text
    assert r.json()["status"] == "completed"
    ev = client.get(f"/signing-requests/{rid}/events", headers=orgA).json()
    assert ev["chain_valid"] and [e["type"] for e in ev["events"]][-1] == "request_completed"
    assert {"consent_given", "signer_signed", "document_viewed", "notification_queued"} <= {e["type"] for e in ev["events"]}
    final = client.get(f"/documents/{doc}/download", headers=orgA).content
    t = pdftotext(final); assert "/s/ Alice Doe" in t and "/s/ Bob Roe" in t and "Electronic Signature Certificate" in t
    assert len(PdfReader(io.BytesIO(final)).pages) == 2
    st = client.get(f"/pdf/{doc}/signatures", headers=orgA).json()["signatures"]
    assert st[0]["intact"] and st[0]["crypto_valid"] and st[0]["trusted"] is False and st[0]["modified_after_signing"] is False
    # signed doc now refuses destructive edits
    assert client.post("/pdf/pages/rotate", headers=orgA, json={"document_id": doc, "expected_version": 2, "angle": 90}).json()["error"]["code"] == "DOCUMENT_SIGNED"
    assert client.post(f"/signing-requests/{rid}/complete", headers=orgA).json()["error"]["code"] == "SIGNING_INVALID_STATE"

def test_event_chain_tamper_detected(client, orgA):
    doc = upload(client, orgA, "simple-1page.pdf").json()["document_id"]
    rid = mk_request(client, orgA, doc)["request_id"]
    from thynkpdf_api.db import SigningEvent
    S = client.app.state.sessions
    with S() as s:
        e = s.query(SigningEvent).filter_by(request_id=rid, seq=2).one(); e.data = '{"email":"mallory@evil.example.com"}'; s.commit()
    ev = client.get(f"/signing-requests/{rid}/events", headers=orgA).json()
    assert ev["chain_valid"] is False and ev["first_invalid_seq"] == 2

def test_decline_and_cancel(client, orgA):
    doc = upload(client, orgA, "simple-1page.pdf").json()["document_id"]
    req = mk_request(client, orgA, doc, sequential=False)
    assert client.post("/signing/session/decline", headers=T(req["signers"][1]["signing_token"]), json={"reason": "no"}).status_code == 200
    assert client.get(f"/signing-requests/{req['request_id']}", headers=orgA).json()["status"] == "declined"
    doc2 = upload(client, orgA, "simple-1page.pdf").json()["document_id"]
    rid2 = mk_request(client, orgA, doc2)["request_id"]
    assert client.post(f"/signing-requests/{rid2}/cancel", headers=orgA).json()["status"] == "cancelled"

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
    for path in [f"/signing-requests/{rid}", f"/signing-requests/{rid}/events", f"/pdf/{doc}/signatures"]:
        assert client.get(path, headers=orgB).status_code == 404, path
    for path in [f"/signing-requests/{rid}/complete", f"/signing-requests/{rid}/cancel"]:
        assert client.post(path, headers=orgB).status_code == 404, path
    assert client.get("/signing-requests", headers=orgB).json() == []
    assert client.post("/signing-requests", headers=orgB, json={"document_id": doc, "expected_version": 1, "title": "x",
        "signers": [{"email": "x@x.example.com", "name": "x", "page": 1, "rect": [1, 1, 2, 2]}]}).status_code == 404
    assert client.post("/pdf/signatures/sign", headers=orgB, json={"document_id": doc, "expected_version": 1}).status_code == 404
