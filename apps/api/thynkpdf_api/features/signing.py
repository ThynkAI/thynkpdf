"""Visual e-signatures (assets + versioned placement), e-sign request workflow (signers, order, consent, sha256 hash-chained
events, final stamped + server-signed PDF) and TYPE B cryptographic signatures (pyHanko).
Visual signatures are NOT cryptographic/PAdES. Legal enforceability is NOT claimed; jurisdiction review pending."""
import base64, hashlib, io, json, secrets
from datetime import datetime, timezone
from pathlib import Path
from typing import Literal
from fastapi import Depends, Header, Request, UploadFile, File
from fastapi.responses import Response
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy import select
import pikepdf
import thynkpdf_engine as eng
import thynkpdf_signatures as sigs
from thynkpdf_storage import validate_key
from ..db import SigningRequest, SigningSigner, SigningEvent, SigningField, SignatureAsset, DocumentVersion, Document, AuditEvent, User

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

    def add_event(s, req, type_, actor, data=None, request=None, audit_action=None, version=None):
        last = s.scalar(select(SigningEvent).where(SigningEvent.request_id == req.id).order_by(SigningEvent.seq.desc()).limit(1))
        seq, prev = (last.seq + 1, last.hash) if last else (1, GENESIS)
        at = datetime.now(timezone.utc).isoformat()
        body = {"request_id": req.id, "seq": seq, "type": type_, "actor": actor, "data": data or {}, "at": at, "prev_hash": prev}
        h = hashlib.sha256(prev.encode() + _canon(body)).hexdigest()
        s.add(SigningEvent(org_id=req.org_id, request_id=req.id, seq=seq, type=type_, actor=actor, data=json.dumps(data or {}, sort_keys=True),
                           at=at, prev_hash=prev, hash=h))
        if audit_action:
            c.audit(s, req.org_id, None, audit_action, req.id, document_id=req.document_id, actor_email=actor,
                    version=version or req.source_version, request=request, details={"signing_request_id": req.id, **(data or {})})
        s.flush(); return h

    def verify_chain(events):
        prev = GENESIS
        for e in events:
            body = {"request_id": e.request_id, "seq": e.seq, "type": e.type, "actor": e.actor, "data": json.loads(e.data), "at": e.at, "prev_hash": e.prev_hash}
            if e.prev_hash != prev or hashlib.sha256(prev.encode() + _canon(body)).hexdigest() != e.hash: return False, e.seq
            prev = e.hash
        return True, None

    def email_of(s, p):
        u = s.get(User, p.user_id); return u.email if u else p.user_id

    # ================= R4.1 signature assets =================
    class AssetOut(BaseModel):
        asset_id: str; kind: Literal["image", "typed"]; width: int; height: int; text: str | None = None; font: str | None = None; created_at: str
    class TypedAssetIn(BaseModel):
        kind: Literal["typed"]; text: str = Field(min_length=1, max_length=100); font: str = "Times-Italic"

    def aout(a): return AssetOut(asset_id=a.id, kind=a.kind, width=a.width, height=a.height, text=a.text, font=a.font, created_at=a.created_at.isoformat())

    def get_asset(s, p, aid):
        a = s.scalar(select(SignatureAsset).where(SignatureAsset.id == aid, SignatureAsset.org_id == p.org_id,
                                                  SignatureAsset.user_id == p.user_id, SignatureAsset.deleted_at.is_(None)))
        if not a: raise c.ApiError(404, "ASSET_NOT_FOUND", "Signature asset not found")
        return a

    def typed_dims(text, font):
        from reportlab.pdfbase.pdfmetrics import stringWidth
        return int(stringWidth(text, font, 48)) + 8, 60

    @app.post("/signatures/assets", response_model=AssetOut, status_code=201, tags=["signatures"],
              openapi_extra={"requestBody": {"content": {
                  "multipart/form-data": {"schema": {"type": "object", "properties": {"file": {"type": "string", "format": "binary"}}, "required": ["file"]}},
                  "application/json": {"schema": {"type": "object", "required": ["kind", "text"], "properties": {"kind": {"const": "typed"}, "text": {"type": "string", "maxLength": 100}, "font": {"type": "string", "enum": sorted(eng.TYPED_FONTS)}}}}}}})
    async def create_asset(request: Request, p=Depends(c.principal), s=Depends(c.db)):
        """PNG (≤1 MB) via multipart `file`, or JSON `{kind:"typed", text, font}`. SVG is rejected (SVG_NOT_SUPPORTED: scripting/external refs risk)."""
        ct = request.headers.get("content-type", "")
        from ..db import uid as mkuid
        aid = mkuid()
        if ct.startswith("application/json"):
            try: b = TypedAssetIn(**(await request.json()))
            except Exception: raise c.ApiError(422, "VALIDATION_ERROR", "Invalid typed asset")
            if b.font not in eng.TYPED_FONTS: raise c.ApiError(422, "EDIT_UNSUPPORTED_FONT", "Unsupported font", {"allowed": sorted(eng.TYPED_FONTS)})
            try: b.text.encode("cp1252")
            except UnicodeEncodeError: raise c.ApiError(422, "EDIT_UNSUPPORTED_CHARACTERS", "Typed signature must be Latin (WinAnsi)")
            w, h = typed_dims(b.text, b.font)
            a = SignatureAsset(id=aid, org_id=p.org_id, user_id=p.user_id, kind="typed", text=b.text, font=b.font, width=w, height=h)
        else:
            form = await request.form(); f = form.get("file")
            if f is None or not hasattr(f, "read"): raise c.ApiError(422, "VALIDATION_ERROR", "multipart field `file` required")
            data = await f.read(1_000_001)
            if data.lstrip()[:5].lower() in (b"<?xml", b"<svg ") or b"<svg" in data[:512].lower():
                raise c.ApiError(415, "SVG_NOT_SUPPORTED", "SVG signatures are not accepted; upload PNG")
            w, h = eng.png_info(data)
            key = validate_key(f"orgs/{p.org_id}/assets/{aid}.png"); sha = c.store.put(key, data)
            a = SignatureAsset(id=aid, org_id=p.org_id, user_id=p.user_id, kind="image", storage_key=key, width=w, height=h, sha256=sha)
        s.add(a); c.audit(s, p.org_id, p.user_id, "signature_asset.create", a.id); s.commit(); return aout(a)

    @app.get("/signatures/assets", response_model=list[AssetOut], tags=["signatures"])
    def list_assets(p=Depends(c.principal), s=Depends(c.db)):
        return [aout(a) for a in s.scalars(select(SignatureAsset).where(SignatureAsset.org_id == p.org_id, SignatureAsset.user_id == p.user_id,
                                                                         SignatureAsset.deleted_at.is_(None)).order_by(SignatureAsset.created_at))]

    @app.delete("/signatures/assets/{asset_id}", status_code=204, tags=["signatures"])
    def delete_asset(asset_id: str, p=Depends(c.principal), s=Depends(c.db)):
        a = get_asset(s, p, asset_id); a.deleted_at = datetime.now(timezone.utc); c.audit(s, p.org_id, p.user_id, "signature_asset.delete", a.id); s.commit()

    def render_typed_png(text, font):
        from PIL import Image, ImageDraw, ImageFont
        im = Image.new("RGBA", (max(8 * len(text) + 16, 60), 40), (255, 255, 255, 0)); dr = ImageDraw.Draw(im)
        dr.text((8, 10), text, fill=(0, 0, 0, 255), font=ImageFont.load_default())
        b = io.BytesIO(); im.save(b, "PNG"); return b.getvalue()

    @app.get("/signatures/assets/{asset_id}/image", tags=["signatures"], responses={200: {"content": {"image/png": {}}}})
    def asset_image(asset_id: str, p=Depends(c.principal), s=Depends(c.db)):
        """PNG preview. Typed assets get a low-fidelity preview; the PDF uses the real standard font."""
        a = get_asset(s, p, asset_id)
        data = c.store.get(a.storage_key) if a.kind == "image" else render_typed_png(a.text, a.font)
        return Response(data, media_type="image/png", headers={"Cache-Control": "private, max-age=300", "X-Content-Type-Options": "nosniff"})

    # ================= R4.2 versioned placement =================
    class Placement(BaseModel):
        asset_id: str; page: int = Field(ge=1); rect: list[float] = Field(min_length=4, max_length=4); field_name: str | None = None
    class PlaceIn(BaseModel):
        document_id: str; expected_version: int = Field(ge=1); placements: list[Placement] = Field(min_length=1, max_length=50)

    @app.post("/pdf/signatures/place", response_model=c.VersionResult, tags=["signatures"])
    def place(b: PlaceIn, request: Request, p=Depends(c.principal), s=Depends(c.db)):
        """Draws the caller's signature assets into page content (visual signature, not cryptographic)."""
        d, data = c.writable(s, p, b.document_id)
        fields = {f["name"]: f for f in eng.list_fields(data)}
        for pl in b.placements:
            if pl.field_name and (pl.field_name not in fields or fields[pl.field_name]["type"] != "signature"):
                raise c.ApiError(422, "FORM_FIELD_NOT_FOUND", "Signature field not found", {"field_name": pl.field_name})
            a = get_asset(s, p, pl.asset_id)
            data = eng.stamp_image(data, pl.page, pl.rect, c.store.get(a.storage_key)) if a.kind == "image" else eng.stamp_text(data, pl.page, pl.rect, a.text, a.font)
        v = c.new_version(s, p, d, b.expected_version, data, "signature_place", {"placements": [x.model_dump() for x in b.placements]})
        c.audit(s, p.org_id, p.user_id, "sign", d.id, document_id=d.id, version=v.number, request=request,
                details={"kind": "visual", "placements": len(b.placements)}); s.commit()
        return c.vres(d, v, {"visual_only": True, "warnings": ["Visual signature only; not a cryptographic (PAdES) signature."]})

    # ================= R4.3 signature requests =================
    FieldType = Literal["signature", "initials", "date", "text"]
    class ReqSigner(BaseModel):
        email: EmailStr; name: str = Field(min_length=1, max_length=200); order: int | None = Field(None, ge=1, le=100)
    class ReqField(BaseModel):
        signer_index: int = Field(ge=0); page: int = Field(ge=1); rect: list[float] = Field(min_length=4, max_length=4); type: FieldType
    class CreateReqIn(BaseModel):
        document_id: str; version: int = Field(ge=1); signers: list[ReqSigner] = Field(min_length=1, max_length=50)
        message: str = Field("", max_length=2000); title: str | None = Field(None, max_length=200)
        fields: list[ReqField] = Field(min_length=1, max_length=500)
    class CreatedReqOut(BaseModel):
        request_id: str; status: str
        signer_links: list[dict] = Field(description="[{signer_index,email,token}] returned ONCE — email delivery is not configured; deliver out-of-band")
    class FieldOut(BaseModel):
        field_id: str; signer_index: int; page: int; rect: list[float]; type: str; completed: bool
    class SignerOut(BaseModel):
        signer_index: int; email: str; name: str; order: int; status: str; consent_at: str | None; signed_at: str | None
    class ReqOut(BaseModel):
        request_id: str; document_id: str; version: int; status: str; message: str; title: str; created_at: str
        final_version_id: str | None; signers: list[SignerOut]; fields: list[FieldOut]; chain_valid: bool; head_hash: str | None
    class EventOut(BaseModel):
        seq: int; type: str; actor: str; data: dict; at: str; prev_hash: str; hash: str
    class EventsOut(BaseModel):
        request_id: str; chain_valid: bool; first_invalid_seq: int | None; head_hash: str | None; events: list[EventOut]

    def signers_of(s, r): return list(s.scalars(select(SigningSigner).where(SigningSigner.request_id == r.id).order_by(SigningSigner.idx)))
    def fields_of(s, r): return list(s.scalars(select(SigningField).where(SigningField.request_id == r.id)))
    def events_of(s, r): return list(s.scalars(select(SigningEvent).where(SigningEvent.request_id == r.id).order_by(SigningEvent.seq)))

    def req_out(s, r):
        sg = signers_of(s, r); idx = {x.id: x.idx for x in sg}; ev = events_of(s, r); ok, _ = verify_chain(ev)
        return ReqOut(request_id=r.id, document_id=r.document_id, version=r.source_version, status=r.status, message=r.message, title=r.title,
                      created_at=r.created_at.isoformat(), final_version_id=r.final_version_id,
                      signers=[SignerOut(signer_index=x.idx, email=x.email, name=x.name, order=x.order, status=x.status,
                                         consent_at=x.consent_at.isoformat() if x.consent_at else None,
                                         signed_at=x.signed_at.isoformat() if x.signed_at else None) for x in sg],
                      fields=[FieldOut(field_id=f.id, signer_index=idx[f.signer_id], page=f.page, rect=json.loads(f.rect), type=f.type,
                                       completed=f.value_kind is not None) for f in fields_of(s, r)],
                      chain_valid=ok, head_hash=ev[-1].hash if ev else None)

    def get_req(s, p, rid):
        r = s.scalar(select(SigningRequest).where(SigningRequest.id == rid, SigningRequest.org_id == p.org_id))
        if not r: raise c.ApiError(404, "SIGNING_REQUEST_NOT_FOUND", "Signature request not found")
        c.get_doc(s, p, r.document_id)  # visibility check (restricted docs)
        return r

    @app.post("/signature-requests", response_model=CreatedReqOut, status_code=201, tags=["signing"])
    def create_req(b: CreateReqIn, request: Request, p=Depends(c.principal), s=Depends(c.db)):
        d, data = c.writable(s, p, b.document_id)
        if b.version != d.current_version:
            raise c.ApiError(409, "VERSION_CONFLICT", "Requests must target the current version", {"current_version": d.current_version})
        v = c.get_ver(s, d); pages = eng.inspect(data)["page_count"]
        if len({x.email.lower() for x in b.signers}) != len(b.signers): raise c.ApiError(422, "VALIDATION_ERROR", "Duplicate signer email")
        for i, f in enumerate(b.fields):
            if f.signer_index >= len(b.signers) or f.page > pages or f.rect[0] >= f.rect[2] or f.rect[1] >= f.rect[3]:
                raise c.ApiError(422, "VALIDATION_ERROR", "Invalid field", {"field_index": i})
        missing = [i for i in range(len(b.signers)) if not any(f.signer_index == i and f.type == "signature" for f in b.fields)]
        if missing: raise c.ApiError(422, "VALIDATION_ERROR", "Every signer needs at least one signature field", {"signer_indexes": missing})
        r = SigningRequest(org_id=p.org_id, document_id=d.id, source_version_id=v.id, source_version=v.number, source_sha256=v.sha256,
                           title=b.title or d.filename, message=b.message, sequential=any(x.order for x in b.signers),
                           status="pending", created_by=p.user_id)
        s.add(r); s.flush(); me = email_of(s, p)
        add_event(s, r, "request_created", me, {"source_sha256": v.sha256, "version": v.number}, request, "request_sent")
        links, rows = [], []
        for i, x in enumerate(b.signers):
            tok = secrets.token_urlsafe(32)
            row = SigningSigner(org_id=p.org_id, request_id=r.id, idx=i, email=x.email.lower(), name=x.name, order=x.order or 1,
                                token_hash=hashlib.sha256(tok.encode()).hexdigest())
            s.add(row); s.flush(); rows.append(row)
            add_event(s, r, "signer_invited", me, {"signer_index": i, "email": row.email, "order": row.order})
            add_event(s, r, "notification_queued", "system", {"signer_index": i, "channel": "email", "delivered": False})
            links.append({"signer_index": i, "email": row.email, "token": tok, "path": f"/sign/{tok}"})
        for f in b.fields:
            s.add(SigningField(org_id=p.org_id, request_id=r.id, signer_id=rows[f.signer_index].id, page=f.page, rect=json.dumps(f.rect), type=f.type))
        s.commit(); return CreatedReqOut(request_id=r.id, status=r.status, signer_links=links)

    @app.get("/signature-requests", response_model=list[ReqOut], tags=["signing"])
    def list_req(document_id: str | None = None, p=Depends(c.principal), s=Depends(c.db)):
        q = select(SigningRequest).where(SigningRequest.org_id == p.org_id)
        if document_id: c.get_doc(s, p, document_id); q = q.where(SigningRequest.document_id == document_id)
        out = []
        for r in s.scalars(q.order_by(SigningRequest.created_at.desc())):
            try: out.append(req_out(s, get_req(s, p, r.id)))
            except c.ApiError: pass
        return out

    @app.get("/signature-requests/{rid}", response_model=ReqOut, tags=["signing"])
    def get_one(rid: str, p=Depends(c.principal), s=Depends(c.db)): return req_out(s, get_req(s, p, rid))

    @app.get("/signature-requests/{rid}/events", response_model=EventsOut, tags=["signing"])
    def events(rid: str, p=Depends(c.principal), s=Depends(c.db)):
        r = get_req(s, p, rid); ev = events_of(s, r); ok, bad = verify_chain(ev)
        return EventsOut(request_id=r.id, chain_valid=ok, first_invalid_seq=bad, head_hash=ev[-1].hash if ev else None,
                         events=[EventOut(seq=e.seq, type=e.type, actor=e.actor, data=json.loads(e.data), at=e.at, prev_hash=e.prev_hash, hash=e.hash) for e in ev])

    @app.post("/signature-requests/{rid}/cancel", response_model=ReqOut, tags=["signing"])
    def cancel(rid: str, request: Request, p=Depends(c.principal), s=Depends(c.db)):
        c.need(p, "member"); r = get_req(s, p, rid)
        if r.status not in ("pending", "needs_attention"): raise c.ApiError(409, "SIGNING_INVALID_STATE", f"Request is {r.status}")
        r.status = "cancelled"; add_event(s, r, "request_cancelled", email_of(s, p), None, request, "request_cancelled"); s.commit()
        return req_out(s, r)

    class RemindOut(BaseModel):
        queued: list[str]; delivered: bool; note: str

    @app.post("/signature-requests/{rid}/remind", response_model=RemindOut, tags=["signing"])
    def remind(rid: str, p=Depends(c.principal), s=Depends(c.db)):
        c.need(p, "member"); r = get_req(s, p, rid)
        if r.status != "pending": raise c.ApiError(409, "SIGNING_INVALID_STATE", f"Request is {r.status}")
        pend = [x.email for x in signers_of(s, r) if x.status == "pending"]
        add_event(s, r, "reminder_queued", email_of(s, p), {"to": pend, "delivered": False}); s.commit()
        return RemindOut(queued=pend, delivered=False, note="No email provider configured (BLOCKED); reminder recorded only.")

    # ---------- finalize ----------
    def audit_page(r, signers, events, head) -> bytes:
        from reportlab.pdfgen import canvas
        buf = io.BytesIO(); cv = canvas.Canvas(buf); y = 800
        def line(t, size=9, font="Helvetica"):
            nonlocal y
            if y < 50: cv.showPage(); y = 800
            cv.setFont(font, size); cv.drawString(40, y, t[:120]); y -= size + 4
        line("THYNKPDF Electronic Signature Certificate", 14, "Helvetica-Bold")
        line(f"Request: {r.id}   Title: {r.title}"); line(f"Source document sha256: {r.source_sha256} (version {r.source_version})")
        line("Signers:", 11, "Helvetica-Bold")
        for x in signers: line(f"  {x.order}. {x.name} <{x.email}>  consent {x.consent_at.isoformat()}  signed {x.signed_at.isoformat()}  ip {x.ip or '-'}")
        line("Event chain (sha256, each hash covers the previous):", 11, "Helvetica-Bold")
        for e in events: line(f"  #{e.seq} {e.at} {e.type} by {e.actor}  {e.hash[:32]}...")
        line(f"Chain head: {head}", 9, "Courier")
        line("Electronic signature record. Visual signatures are not cryptographic; legal effect depends on jurisdiction.", 8)
        cv.showPage(); cv.save(); return buf.getvalue()

    def finalize(s, r, request):
        d = s.get(Document, r.document_id)
        if d.current_version != r.source_version:
            r.status = "needs_attention"
            add_event(s, r, "finalize_blocked", "system", {"reason": "document_changed", "current_version": d.current_version})
            return
        data = c.store.get(s.get(DocumentVersion, r.source_version_id).storage_key)
        sg = signers_of(s, r)
        for f in fields_of(s, r):
            rect = json.loads(f.rect)
            if f.value_kind == "image": data = eng.stamp_image(data, f.page, rect, c.store.get(f.value_image_key))
            else: data = eng.stamp_text(data, f.page, rect, f.value_text, f.value_font or "Helvetica")
        add_event(s, r, "document_finalizing", "system", {"stamped_sha256": hashlib.sha256(data).hexdigest()})
        ev = events_of(s, r)
        pdf = eng.open_pdf(data); extra = pikepdf.open(io.BytesIO(audit_page(r, sg, ev, ev[-1].hash))); pdf.pages.extend(extra.pages)
        buf = io.BytesIO(); pdf.save(buf)
        signer = server_signer()
        data = signer.sign(buf.getvalue(), field_name="ThynkPDF-Completion", reason=f"THYNKPDF e-sign completion {r.id}; chain {ev[-1].hash}")
        creator = SimpleP(user_id=r.created_by, org_id=r.org_id)
        v = c.new_version(s, creator, d, r.source_version, data, "esign_complete", {"signing_request_id": r.id})
        r.status, r.final_version_id = "completed", v.id
        add_event(s, r, "request_completed", "system", {"final_version_id": v.id, "final_sha256": v.sha256,
                  "server_cert_trusted": signer.trusted and not signer.untrusted_dev}, request, "completed", v.number)

    class SimpleP:
        def __init__(self, user_id, org_id): self.user_id, self.org_id = user_id, org_id

    # ---------- signer link flow ----------
    def by_token(s, token):
        x = s.scalar(select(SigningSigner).where(SigningSigner.token_hash == hashlib.sha256(token.encode()).hexdigest()))
        if not x: raise c.ApiError(404, "SIGNER_TOKEN_INVALID", "Invalid or expired signing link")
        return x, s.get(SigningRequest, x.request_id)

    def can_sign(s, x, r):
        if r.status != "pending": return False, f"request_{r.status}"
        if x.status != "pending": return False, f"already_{x.status}"
        if r.sequential and any(y.order < x.order and y.status != "signed" for y in signers_of(s, r)): return False, "waiting_for_previous_signers"
        return True, None

    class SignSessionOut(BaseModel):
        request_id: str; title: str; message: str; signer_index: int; signer_name: str; signer_email: str; status: str
        can_sign: bool; blocked_reason: str | None; consent_text: str; consent_text_version: str
        document_sha256: str; page_count: int; document_path: str; fields: list[FieldOut]
    class SignerPlacement(BaseModel):
        field_id: str
        text: str | None = Field(None, max_length=200, description="typed signature/initials, or value for text/date")
        font: str | None = None
        image_base64: str | None = Field(None, description="PNG ≤1 MB, base64, for signature/initials")
    class CompleteIn(BaseModel):
        consent: bool = Field(description="Must be true (consent_text_version v1)"); consent_text_version: str = "v1"
        placements: list[SignerPlacement] = Field(min_length=1, max_length=100)
    class DeclineIn(BaseModel):
        reason: str = Field("", max_length=500)

    @app.get("/sign/{token}", response_model=SignSessionOut, tags=["signing-signer"])
    def sign_session(token: str, request: Request, s=Depends(c.db)):
        x, r = by_token(s, token); ok, why = can_sign(s, x, r); v = s.get(DocumentVersion, r.source_version_id)
        add_event(s, r, "document_viewed", x.email, None, request, "view"); s.commit()
        mine = [f for f in fields_of(s, r) if f.signer_id == x.id]
        return SignSessionOut(request_id=r.id, title=r.title, message=r.message, signer_index=x.idx, signer_name=x.name, signer_email=x.email,
                              status=x.status, can_sign=ok, blocked_reason=why, consent_text=CONSENT_TEXT_V1, consent_text_version="v1",
                              document_sha256=v.sha256, page_count=eng.inspect(c.store.get(v.storage_key))["page_count"],
                              document_path=f"/sign/{token}/document",
                              fields=[FieldOut(field_id=f.id, signer_index=x.idx, page=f.page, rect=json.loads(f.rect), type=f.type,
                                               completed=f.value_kind is not None) for f in mine])

    @app.get("/sign/{token}/document", tags=["signing-signer"], responses={200: {"content": {"application/pdf": {}}}})
    def sign_doc(token: str, s=Depends(c.db)):
        x, r = by_token(s, token)
        if r.status == "cancelled": raise c.ApiError(409, "SIGNING_INVALID_STATE", "Request cancelled")
        v = s.get(DocumentVersion, r.source_version_id)
        return Response(c.store.get(v.storage_key), media_type="application/pdf", headers={"ETag": f'"{v.sha256}"', "Cache-Control": "no-store"})

    @app.post("/sign/{token}/complete", response_model=ReqOut, tags=["signing-signer"])
    def sign_complete(token: str, b: CompleteIn, request: Request, s=Depends(c.db)):
        x, r = by_token(s, token); ok, why = can_sign(s, x, r)
        if not ok: raise c.ApiError(409, "SIGNING_NOT_ALLOWED", "Signer cannot sign now", {"reason": why})
        if not b.consent or b.consent_text_version != "v1": raise c.ApiError(422, "CONSENT_REQUIRED", "Consent to v1 text is required")
        mine = {f.id: f for f in fields_of(s, r) if f.signer_id == x.id}
        given = {pl.field_id: pl for pl in b.placements}
        if set(given) - set(mine): raise c.ApiError(422, "VALIDATION_ERROR", "Unknown field_id", {"field_ids": sorted(set(given) - set(mine))})
        today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
        for fid, f in mine.items():
            pl = given.get(fid)
            if f.type == "date" and (pl is None or not pl.text): f.value_kind, f.value_text, f.value_font = "text", today, "Helvetica"; continue
            if pl is None: raise c.ApiError(422, "VALIDATION_ERROR", "All your fields must be completed", {"missing_field_id": fid})
            if pl.image_base64 and f.type in ("signature", "initials"):
                try: png = base64.b64decode(pl.image_base64, validate=True)
                except Exception: raise c.ApiError(422, "VALIDATION_ERROR", "image_base64 is not valid base64")
                eng.png_info(png)
                key = validate_key(f"orgs/{r.org_id}/signing/{r.id}/{fid}.png"); c.store.put(key, png)
                f.value_kind, f.value_image_key = "image", key
            elif pl.text:
                font = pl.font or ("Times-Italic" if f.type in ("signature", "initials") else "Helvetica")
                if font not in eng.TYPED_FONTS: raise c.ApiError(422, "EDIT_UNSUPPORTED_FONT", "Unsupported font", {"allowed": sorted(eng.TYPED_FONTS)})
                try: pl.text.encode("cp1252")
                except UnicodeEncodeError: raise c.ApiError(422, "EDIT_UNSUPPORTED_CHARACTERS", "Text must be Latin (WinAnsi)")
                f.value_kind, f.value_text, f.value_font = "text", pl.text, font
            else:
                raise c.ApiError(422, "VALIDATION_ERROR", "Placement needs text or image_base64", {"field_id": fid})
        now = datetime.now(timezone.utc)
        x.status, x.consent_at, x.signed_at = "signed", now, now
        x.ip = request.client.host if request.client else None; x.user_agent = (request.headers.get("user-agent") or "")[:300]
        add_event(s, r, "consent_given", x.email, {"consent_text_sha256": hashlib.sha256(CONSENT_TEXT_V1.encode()).hexdigest()})
        add_event(s, r, "signer_signed", x.email, {"signer_index": x.idx, "fields": sorted(mine), "document_sha256": r.source_sha256}, request, "sign")
        if all(y.status == "signed" for y in signers_of(s, r)): finalize(s, r, request)
        s.commit(); return req_out(s, r)

    @app.post("/sign/{token}/decline", response_model=ReqOut, tags=["signing-signer"])
    def sign_decline(token: str, b: DeclineIn, request: Request, s=Depends(c.db)):
        x, r = by_token(s, token)
        if r.status != "pending" or x.status != "pending": raise c.ApiError(409, "SIGNING_INVALID_STATE", "Cannot decline now")
        x.status = "declined"; r.status = "declined"; add_event(s, r, "signer_declined", x.email, {"reason": b.reason}, request, "declined"); s.commit()
        return req_out(s, r)

    # ================= R4.4 document audit =================
    class DocAuditOut(BaseModel):
        at: str; actor_email: str | None; action: str; version: int | None; ip: str | None = None; user_agent: str | None = None; details: dict

    @app.get("/documents/{doc_id}/audit", response_model=list[DocAuditOut], tags=["audit"])
    def doc_audit(doc_id: str, limit: int = 200, p=Depends(c.principal), s=Depends(c.db)):
        d = c.get_doc(s, p, doc_id)
        rows = s.scalars(select(AuditEvent).where(AuditEvent.org_id == p.org_id, AuditEvent.document_id == d.id)
                         .order_by(AuditEvent.created_at.desc()).limit(min(max(limit, 1), 1000)))
        norm = lambda a: a.split(".", 1)[1] if a.startswith("document.") else a
        return [DocAuditOut(at=e.created_at.isoformat(), actor_email=e.actor_email, action=norm(e.action), version=e.version,
                            ip=e.ip, user_agent=e.user_agent, details=json.loads(e.details or "{}")) for e in rows]

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
