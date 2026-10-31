"""TYPE A e-sign workflow (signers, order, consent, events with sha256 hash chain, final stamped PDF) and
TYPE B cryptographic signatures (pyHanko). Legal enforceability is NOT claimed; jurisdiction review pending."""
import hashlib, io, json, secrets
from datetime import datetime, timezone
from pathlib import Path
from fastapi import Depends, Header, Request
from fastapi.responses import Response
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy import select, func
import pikepdf
import thynkpdf_engine as eng
import thynkpdf_signatures as sigs
from ..db import SigningRequest, SigningSigner, SigningEvent, DocumentVersion, Document

CONSENT_TEXT_V1 = ("I agree to sign this document electronically. I understand my electronic signature, the time, "
                   "and this consent are recorded in a tamper-evident audit trail.")
GENESIS = "0" * 64


def _canon(e: dict) -> bytes: return json.dumps(e, sort_keys=True, separators=(",", ":")).encode()


def register(app, c):
    _signer_cache = {}

    def server_signer():
        if "s" not in _signer_cache:
            st = c.settings
            if st.signing_cert and st.signing_key:
                _signer_cache["s"] = sigs.Signer(st.signing_cert, st.signing_key, st.signing_key_pass, st.signing_cert_trusted)
            else:
                cert, key = sigs.generate_dev_cert(str(Path(c.store.root).parent / "dev-signing"))
                _signer_cache["s"] = sigs.Signer(cert, key, "", False)
        return _signer_cache["s"]

    def trust_roots():
        s = server_signer(); return [s.cert_pem] if s.trusted and not s.untrusted_dev else []

    def add_event(s, req, type_, actor, data=None):
        last = s.scalar(select(SigningEvent).where(SigningEvent.request_id == req.id).order_by(SigningEvent.seq.desc()).limit(1))
        seq, prev = (last.seq + 1, last.hash) if last else (1, GENESIS)
        at = datetime.now(timezone.utc).isoformat()
        body = {"request_id": req.id, "seq": seq, "type": type_, "actor": actor, "data": data or {}, "at": at, "prev_hash": prev}
        h = hashlib.sha256(prev.encode() + _canon(body)).hexdigest()
        s.add(SigningEvent(org_id=req.org_id, request_id=req.id, seq=seq, type=type_, actor=actor, data=json.dumps(data or {}, sort_keys=True),
                           at=at, prev_hash=prev, hash=h))
        s.flush(); return h

    def verify_chain(events) -> tuple[bool, int | None]:
        prev = GENESIS
        for e in events:
            body = {"request_id": e.request_id, "seq": e.seq, "type": e.type, "actor": e.actor, "data": json.loads(e.data), "at": e.at, "prev_hash": e.prev_hash}
            if e.prev_hash != prev or hashlib.sha256(prev.encode() + _canon(body)).hexdigest() != e.hash: return False, e.seq
            prev = e.hash
        return True, None

    # ---------- models ----------
    class SignerIn(BaseModel):
        email: EmailStr; name: str = Field(min_length=1, max_length=200); order: int = Field(1, ge=1, le=100)
        page: int = Field(ge=1); rect: list[float] = Field(min_length=4, max_length=4, description="signature box [x0,y0,x1,y1]")
    class CreateIn(BaseModel):
        document_id: str; expected_version: int = Field(ge=1); title: str = Field(min_length=1, max_length=200)
        message: str = Field("", max_length=2000); sequential: bool = True; signers: list[SignerIn] = Field(min_length=1, max_length=50)
    class SignerOut(BaseModel):
        signer_id: str; email: str; name: str; order: int; status: str; page: int; rect: list[float]
        consent_at: str | None; signed_at: str | None
    class SignerWithToken(SignerOut):
        signing_token: str = Field(description="Returned ONCE. Deliver to the signer out-of-band; send as X-Signer-Token.")
    class RequestOut(BaseModel):
        request_id: str; document_id: str; source_version: int; source_sha256: str; title: str; message: str; sequential: bool
        status: str; final_version_id: str | None; created_at: str; signers: list[SignerOut]
    class CreatedOut(RequestOut):
        signers: list[SignerWithToken]
    class EventOut(BaseModel):
        seq: int; type: str; actor: str; data: dict; at: str; prev_hash: str; hash: str
    class EventsOut(BaseModel):
        request_id: str; chain_valid: bool; first_invalid_seq: int | None; head_hash: str | None; events: list[EventOut]
    class ConsentIn(BaseModel):
        accept: bool; consent_text_version: str = "v1"
    class SignIn(BaseModel):
        signature_text: str = Field(min_length=1, max_length=100, description="Typed signature (e.g. full name)")
    class DeclineIn(BaseModel):
        reason: str = Field("", max_length=500)

    def sout(x): return SignerOut(signer_id=x.id, email=x.email, name=x.name, order=x.order, status=x.status, page=x.page,
                                 rect=json.loads(x.rect), consent_at=x.consent_at.isoformat() if x.consent_at else None,
                                 signed_at=x.signed_at.isoformat() if x.signed_at else None)

    def signers_of(s, req): return list(s.scalars(select(SigningSigner).where(SigningSigner.request_id == req.id).order_by(SigningSigner.order, SigningSigner.email)))

    def rout(s, req, signers=None):
        return dict(request_id=req.id, document_id=req.document_id, source_version=req.source_version, source_sha256=req.source_sha256,
                    title=req.title, message=req.message, sequential=req.sequential, status=req.status, final_version_id=req.final_version_id,
                    created_at=req.created_at.isoformat(), signers=signers if signers is not None else [sout(x) for x in signers_of(s, req)])

    def get_req(s, p, rid):
        r = s.scalar(select(SigningRequest).where(SigningRequest.id == rid, SigningRequest.org_id == p.org_id))
        if not r: raise c.ApiError(404, "SIGNING_REQUEST_NOT_FOUND", "Signing request not found")
        return r

    # ---------- owner side ----------
    @app.post("/signing-requests", response_model=CreatedOut, status_code=201, tags=["signing"])
    def create(b: CreateIn, p=Depends(c.principal), s=Depends(c.db)):
        c.need(p, "member"); d = c.get_doc(s, p, b.document_id)
        if b.expected_version != d.current_version:
            raise c.ApiError(409, "VERSION_CONFLICT", "Document changed", {"current_version": d.current_version})
        v = c.get_ver(s, d); data = c.load(d, v); pages = eng.inspect(data)["page_count"]
        if len({x.email.lower() for x in b.signers}) != len(b.signers): raise c.ApiError(422, "VALIDATION_ERROR", "Duplicate signer email")
        for x in b.signers:
            if x.page > pages or x.rect[0] >= x.rect[2] or x.rect[1] >= x.rect[3]:
                raise c.ApiError(422, "VALIDATION_ERROR", "Invalid signer page/rect", {"email": x.email})
        req = SigningRequest(org_id=p.org_id, document_id=d.id, source_version_id=v.id, source_version=v.number, source_sha256=v.sha256,
                             title=b.title, message=b.message, sequential=b.sequential, created_by=p.user_id)
        s.add(req); s.flush(); out = []
        add_event(s, req, "request_created", p.user_id, {"source_sha256": v.sha256, "source_version": v.number, "sequential": b.sequential})
        for x in b.signers:
            tok = secrets.token_urlsafe(32)
            row = SigningSigner(org_id=p.org_id, request_id=req.id, email=x.email.lower(), name=x.name, order=x.order,
                                token_hash=hashlib.sha256(tok.encode()).hexdigest(), page=x.page, rect=json.dumps(x.rect))
            s.add(row); s.flush()
            add_event(s, req, "signer_invited", p.user_id, {"signer_id": row.id, "email": row.email, "order": row.order})
            add_event(s, req, "notification_queued", "system", {"signer_id": row.id, "channel": "email", "delivered": False,
                                                                 "note": "no email provider configured; deliver token out-of-band"})
            out.append(SignerWithToken(**sout(row).model_dump(), signing_token=tok))
        c.audit(s, p.org_id, p.user_id, "signing.create", req.id); s.commit()
        return CreatedOut(**rout(s, req, out))

    @app.get("/signing-requests", response_model=list[RequestOut], tags=["signing"])
    def list_(p=Depends(c.principal), s=Depends(c.db)):
        return [RequestOut(**rout(s, r)) for r in s.scalars(select(SigningRequest).where(SigningRequest.org_id == p.org_id).order_by(SigningRequest.created_at.desc()))]

    @app.get("/signing-requests/{rid}", response_model=RequestOut, tags=["signing"])
    def get(rid: str, p=Depends(c.principal), s=Depends(c.db)): return RequestOut(**rout(s, get_req(s, p, rid)))

    @app.get("/signing-requests/{rid}/events", response_model=EventsOut, tags=["signing"])
    def events(rid: str, p=Depends(c.principal), s=Depends(c.db)):
        r = get_req(s, p, rid); ev = list(s.scalars(select(SigningEvent).where(SigningEvent.request_id == r.id).order_by(SigningEvent.seq)))
        ok, bad = verify_chain(ev)
        return EventsOut(request_id=r.id, chain_valid=ok, first_invalid_seq=bad, head_hash=ev[-1].hash if ev else None,
                         events=[EventOut(seq=e.seq, type=e.type, actor=e.actor, data=json.loads(e.data), at=e.at, prev_hash=e.prev_hash, hash=e.hash) for e in ev])

    @app.post("/signing-requests/{rid}/cancel", response_model=RequestOut, tags=["signing"])
    def cancel(rid: str, p=Depends(c.principal), s=Depends(c.db)):
        c.need(p, "member"); r = get_req(s, p, rid)
        if r.status != "in_progress": raise c.ApiError(409, "SIGNING_INVALID_STATE", f"Request is {r.status}")
        r.status = "cancelled"; add_event(s, r, "request_cancelled", p.user_id); c.audit(s, p.org_id, p.user_id, "signing.cancel", r.id); s.commit()
        return RequestOut(**rout(s, r))

    def audit_page(req, signers, events, head) -> bytes:
        from reportlab.pdfgen import canvas
        buf = io.BytesIO(); cv = canvas.Canvas(buf); y = 800
        def line(t, size=9, font="Helvetica"):
            nonlocal y
            if y < 50: cv.showPage(); y = 800
            cv.setFont(font, size); cv.drawString(40, y, t[:120]); y -= size + 4
        line("THYNKPDF Electronic Signature Certificate", 14, "Helvetica-Bold")
        line(f"Request: {req.id}   Title: {req.title}"); line(f"Source document sha256: {req.source_sha256} (version {req.source_version})")
        line("Signers:", 11, "Helvetica-Bold")
        for x in signers: line(f"  {x.order}. {x.name} <{x.email}>  consent {x.consent_at.isoformat()}  signed {x.signed_at.isoformat()}")
        line("Event chain (sha256, each hash covers the previous):", 11, "Helvetica-Bold")
        for e in events: line(f"  #{e.seq} {e.at} {e.type} by {e.actor}  {e.hash[:32]}...")
        line(f"Chain head: {head}", 9, "Courier")
        line("Electronic signature record. Legal effect depends on jurisdiction; not legal advice.", 8)
        cv.showPage(); cv.save(); return buf.getvalue()

    @app.post("/signing-requests/{rid}/complete", response_model=RequestOut, tags=["signing"])
    def complete(rid: str, p=Depends(c.principal), s=Depends(c.db)):
        """Builds the final PDF: stamps each typed signature into page content, appends a certificate page with the
        event hash chain, then applies a server cryptographic signature (pyHanko) so later changes are detectable."""
        c.need(p, "member"); r = get_req(s, p, rid)
        if r.status != "in_progress": raise c.ApiError(409, "SIGNING_INVALID_STATE", f"Request is {r.status}")
        sg = signers_of(s, r)
        if any(x.status != "signed" for x in sg):
            raise c.ApiError(409, "SIGNING_INCOMPLETE", "Not all signers have signed", {"pending": [x.email for x in sg if x.status != "signed"]})
        d = c.get_doc(s, p, r.document_id)
        if d.current_version != r.source_version:
            raise c.ApiError(409, "VERSION_CONFLICT", "Document changed after the request was created", {"current_version": d.current_version})
        data = c.load(d, c.get_ver(s, d))
        for x in sg:
            x0, y0, x1, y1 = json.loads(x.rect)
            data = eng.insert_text(data, x.page, f"/s/ {x.signature_text}", x0 + 2, y0 + (y1 - y0) / 2, 12, "Helvetica-Oblique")
            data = eng.insert_text(data, x.page, f"{x.name} - signed {x.signed_at.strftime('%Y-%m-%d %H:%M UTC')} - ref {x.id[:8]}", x0 + 2, y0 + 2, 6, "Helvetica")
        add_event(s, r, "document_finalizing", p.user_id, {"stamped_sha256": hashlib.sha256(data).hexdigest()})
        ev = list(s.scalars(select(SigningEvent).where(SigningEvent.request_id == r.id).order_by(SigningEvent.seq)))
        page = audit_page(r, sg, ev, ev[-1].hash)
        pdf = eng.open_pdf(data); extra = pikepdf.open(io.BytesIO(page)); pdf.pages.extend(extra.pages)
        b = io.BytesIO(); pdf.save(b); data = b.getvalue()
        signer = server_signer()
        data = signer.sign(data, field_name="ThynkPDF-Completion", reason=f"THYNKPDF e-sign completion {r.id}; chain {ev[-1].hash}")
        v = c.new_version(s, p, d, r.source_version, data, "esign_complete", {"signing_request_id": r.id})
        r.status, r.final_version_id = "completed", v.id
        add_event(s, r, "request_completed", p.user_id, {"final_version_id": v.id, "final_sha256": v.sha256,
                                                          "server_cert_trusted": signer.trusted and not signer.untrusted_dev})
        s.commit(); return RequestOut(**rout(s, r))

    # ---------- signer side (no account; X-Signer-Token) ----------
    def session(s, token: str | None):
        if not token: raise c.ApiError(401, "SIGNER_TOKEN_REQUIRED", "X-Signer-Token header required")
        x = s.scalar(select(SigningSigner).where(SigningSigner.token_hash == hashlib.sha256(token.encode()).hexdigest()))
        if not x: raise c.ApiError(401, "SIGNER_TOKEN_INVALID", "Invalid signing token")
        r = s.get(SigningRequest, x.request_id)
        return x, r

    def can_sign(s, x, r):
        if r.status != "in_progress": return False, f"request_{r.status}"
        if x.status in ("signed", "declined"): return False, f"already_{x.status}"
        if r.sequential:
            blockers = [y for y in signers_of(s, r) if y.order < x.order and y.status != "signed"]
            if blockers: return False, "waiting_for_previous_signers"
        return True, None

    class SessionOut(BaseModel):
        request_id: str; title: str; message: str; signer: SignerOut; request_status: str; can_sign: bool; blocked_reason: str | None
        consent_text: str; consent_text_version: str; document_sha256: str; page_count: int

    @app.get("/signing/session", response_model=SessionOut, tags=["signing-signer"])
    def sess(x_signer_token: str | None = Header(None), s=Depends(c.db)):
        x, r = session(s, x_signer_token); ok, why = can_sign(s, x, r)
        v = s.get(DocumentVersion, r.source_version_id)
        add_event(s, r, "document_viewed", x.email); s.commit()
        return SessionOut(request_id=r.id, title=r.title, message=r.message, signer=sout(x), request_status=r.status, can_sign=ok,
                          blocked_reason=why, consent_text=CONSENT_TEXT_V1, consent_text_version="v1", document_sha256=v.sha256,
                          page_count=eng.inspect(c.store.get(v.storage_key))["page_count"])

    @app.get("/signing/session/document", tags=["signing-signer"], responses={200: {"content": {"application/pdf": {}}}})
    def sess_doc(x_signer_token: str | None = Header(None), s=Depends(c.db)):
        x, r = session(s, x_signer_token); v = s.get(DocumentVersion, r.source_version_id)
        return Response(c.store.get(v.storage_key), media_type="application/pdf", headers={"ETag": f'"{v.sha256}"'})

    @app.post("/signing/session/consent", response_model=SignerOut, tags=["signing-signer"])
    def consent(b: ConsentIn, request: Request, x_signer_token: str | None = Header(None), s=Depends(c.db)):
        x, r = session(s, x_signer_token)
        if not b.accept or b.consent_text_version != "v1": raise c.ApiError(422, "CONSENT_REQUIRED", "Consent to v1 text is required")
        if r.status != "in_progress" or x.status in ("signed", "declined"): raise c.ApiError(409, "SIGNING_INVALID_STATE", "Cannot consent now")
        x.status, x.consent_at = "consented", datetime.now(timezone.utc)
        add_event(s, r, "consent_given", x.email, {"consent_text_sha256": hashlib.sha256(CONSENT_TEXT_V1.encode()).hexdigest(),
                                                    "user_agent": (request.headers.get("user-agent") or "")[:200]})
        s.commit(); return sout(x)

    @app.post("/signing/session/sign", response_model=SignerOut, tags=["signing-signer"])
    def sign(b: SignIn, x_signer_token: str | None = Header(None), s=Depends(c.db)):
        x, r = session(s, x_signer_token); ok, why = can_sign(s, x, r)
        if not ok: raise c.ApiError(409, "SIGNING_NOT_ALLOWED", "Signer cannot sign now", {"reason": why})
        if x.status != "consented": raise c.ApiError(409, "CONSENT_REQUIRED", "Consent first")
        try: b.signature_text.encode("cp1252")
        except UnicodeEncodeError: raise c.ApiError(422, "EDIT_UNSUPPORTED_CHARACTERS", "Signature text must be Latin (WinAnsi)")
        x.status, x.signed_at, x.signature_text = "signed", datetime.now(timezone.utc), b.signature_text
        add_event(s, r, "signer_signed", x.email, {"signer_id": x.id, "signature_text": b.signature_text, "document_sha256": r.source_sha256})
        s.commit(); return sout(x)

    @app.post("/signing/session/decline", response_model=SignerOut, tags=["signing-signer"])
    def decline(b: DeclineIn, x_signer_token: str | None = Header(None), s=Depends(c.db)):
        x, r = session(s, x_signer_token)
        if r.status != "in_progress" or x.status == "signed": raise c.ApiError(409, "SIGNING_INVALID_STATE", "Cannot decline now")
        x.status = "declined"; r.status = "declined"; add_event(s, r, "signer_declined", x.email, {"reason": b.reason}); s.commit()
        return sout(x)

    # ---------- TYPE B cryptographic signatures ----------
    class CryptoSignIn(BaseModel):
        document_id: str; expected_version: int = Field(ge=1)
        field_name: str = Field("ThynkSig1", pattern=r"^[A-Za-z0-9_\-]{1,60}$")
        reason: str | None = Field(None, max_length=200); location: str | None = Field(None, max_length=200)
        page: int | None = Field(None, ge=1); rect: list[float] | None = Field(None, min_length=4, max_length=4)
    class SigStatus(BaseModel):
        field: str; intact: bool; crypto_valid: bool; trusted: bool; coverage: str | None = None; modification_level: str | None = None
        docmdp_ok: bool | None = None; signing_time: str | None = None; signer_subject: str | None = None
        modified_after_signing: bool | None; error: str | None = None
    class VerifyOut(BaseModel):
        document_id: str; version: int; signatures: list[SigStatus]; notes: list[str]
    class CertOut(BaseModel):
        subject: str; issuer: str; serial: str; not_after: str; trusted_identity: bool; dev_untrusted: bool; sha256_fingerprint: str

    @app.get("/pdf/signatures/certificate", response_model=CertOut, tags=["signatures"])
    def cert(p=Depends(c.principal)):
        """Public certificate info for the server signing identity. The private key is never returned."""
        return server_signer().info()

    @app.post("/pdf/signatures/sign", response_model=c.VersionResult, tags=["signatures"])
    def crypto_sign(b: CryptoSignIn, p=Depends(c.principal), s=Depends(c.db)):
        d, data = c.writable(s, p, b.document_id, allow_signed=True)
        try:
            out = server_signer().sign(data, b.field_name, b.reason, b.location, b.page, b.rect)
        except sigs.SignatureError as e: raise c.ApiError(422, e.code, e.message, e.details)
        v = c.new_version(s, p, d, b.expected_version, out, "crypto_sign", {"field": b.field_name})
        info = server_signer().info()
        return c.vres(d, v, {"certificate": info, "warnings": ([] if info["trusted_identity"] else
                       ["Signed with an UNTRUSTED development certificate; validators will not treat it as a trusted identity."])})

    @app.get("/pdf/{doc_id}/signatures", response_model=VerifyOut, tags=["signatures"])
    def verify(doc_id: str, version: int | None = None, p=Depends(c.principal), s=Depends(c.db)):
        d = c.get_doc(s, p, doc_id); v = c.get_ver(s, d, number=version)
        try: res = sigs.verify(c.load(d, v), trust_roots())
        except sigs.SignatureError as e: raise c.ApiError(422, e.code, e.message)
        return VerifyOut(document_id=d.id, version=v.number, signatures=res,
                         notes=["trusted=false means the certificate chain is not anchored in a configured trust root.",
                                "No timestamp authority configured; signing_time is signer-reported."])
