import threading, time
from collections import defaultdict, deque
from typing import Literal
from fastapi import Depends
from pydantic import BaseModel, Field
import thynkpdf_ai as ai
from ..db import OrgAISettings


class Citation(BaseModel):
    page: int; quote: str


class AIOut(BaseModel):
    answer: str; citations: list[Citation]; model: str
    uncertain: bool = Field(description="true when the answer could not be verified against the document")
    retrieval: str = "bm25-lexical"; external_processing: bool = False; document_id: str; version: int


def register(app, c):
    lock = threading.Lock(); hits: dict[str, deque] = defaultdict(deque)

    def rate_limit(org):
        now = time.monotonic(); lim = c.settings.ai_rate_per_min
        with lock:
            q = hits[org]
            while q and now - q[0] > 60: q.popleft()
            if len(q) >= lim:
                raise c.ApiError(429, "RATE_LIMITED", "AI rate limit reached", {"retry_after": int(60 - (now - q[0])) + 1, "limit_per_minute": lim})
            q.append(now)

    def provider_for(s, p):
        st = s.get(OrgAISettings, p.org_id)
        if st and st.external_enabled and st.provider == "openai_compatible":
            cfg = c.settings
            if not (cfg.ai_external_base_url and cfg.ai_external_api_key and cfg.ai_external_model):
                raise c.ApiError(503, "AI_PROVIDER_NOT_CONFIGURED", "External AI provider opted in but not configured on the server")
            return ai.OpenAICompatibleProvider(cfg.ai_external_base_url, cfg.ai_external_api_key, cfg.ai_external_model)
        return ai.StubProvider()

    def context(s, p, doc_id, version, page_range, query):
        d = c.get_doc(s, p, doc_id); v = c.get_ver(s, d, number=version)
        if page_range and (len(page_range) != 2 or page_range[0] < 1 or page_range[0] > page_range[1]):
            raise c.ApiError(422, "VALIDATION_ERROR", "page_range = [start, end]")
        pages = ai.extract_pages(c.load(d, v))
        chunks = ai.chunk_pages(pages, page_range=page_range)
        if not chunks:
            raise c.ApiError(422, "NO_TEXT_LAYER", "No extractable text (scanned?). OCR is not available on this server yet.")
        ctx = [ch for _, ch in ai.rank(chunks, query, k=6)] if query else chunks
        out, n = [], 0
        for ch in ctx:
            if n + len(ch.text) > c.settings.ai_max_context_chars: break
            out.append(ch); n += len(ch.text)
        return d, v, out

    def run(s, p, d, v, kind, fn):
        prov = provider_for(s, p)
        try: answer, cites, unc = fn(prov)
        except c.ApiError: raise
        except Exception: raise c.ApiError(502, "AI_PROVIDER_ERROR", "AI provider failed")
        c.audit(s, p.org_id, p.user_id, f"ai.{kind}", d.id, document_id=d.id, version=v.number,
                details={"model": prov.name, "external": prov.external})
        s.commit()
        return AIOut(answer=answer, citations=cites, model=prov.name, uncertain=unc, external_processing=prov.external,
                     document_id=d.id, version=v.number)

    class AskIn(BaseModel):
        document_id: str; version: int | None = Field(None, ge=1); question: str = Field(min_length=1, max_length=2000)
        page_range: list[int] | None = None
    class SummarizeIn(BaseModel):
        document_id: str; version: int | None = Field(None, ge=1); length: Literal["short", "long"] = "short"
        page_range: list[int] | None = None


    @app.post("/ai/ask", response_model=AIOut, tags=["ai"])
    def ask(b: AskIn, p=Depends(c.principal), s=Depends(c.db)):
        """Answers from the document with page citations. Document text is untrusted data. 429 RATE_LIMITED (details.retry_after)."""
        rate_limit(p.org_id)
        d, v, ctx = context(s, p, b.document_id, b.version, b.page_range, b.question)
        if not ctx:
            return AIOut(answer="I could not find this in the document.", citations=[], model=provider_for(s, p).name, uncertain=True,
                         document_id=d.id, version=v.number)
        return run(s, p, d, v, "ask", lambda prov: prov.ask(b.question, ctx))

    @app.post("/ai/summarize", response_model=AIOut, tags=["ai"])
    def summarize(b: SummarizeIn, p=Depends(c.principal), s=Depends(c.db)):
        rate_limit(p.org_id)
        d, v, ctx = context(s, p, b.document_id, b.version, b.page_range, None)
        return run(s, p, d, v, "summarize", lambda prov: prov.summarize(ctx, b.length))

    class AISettingsIn(BaseModel):
        external_enabled: bool; provider: Literal["stub", "openai_compatible"] = "stub"
        acknowledge_external_processing: bool = Field(False, description="must be true to enable external processing")
    class AISettingsOut(BaseModel):
        external_enabled: bool; provider: str; external_configured: bool; rate_limit_per_minute: int

    def sout(st):
        cfg = c.settings
        return AISettingsOut(external_enabled=bool(st and st.external_enabled), provider=st.provider if st else "stub",
                             external_configured=bool(cfg.ai_external_base_url and cfg.ai_external_api_key and cfg.ai_external_model),
                             rate_limit_per_minute=cfg.ai_rate_per_min)

    @app.get("/ai/settings", response_model=AISettingsOut, tags=["ai"])
    def get_settings(p=Depends(c.principal), s=Depends(c.db)): return sout(s.get(OrgAISettings, p.org_id))

    @app.put("/ai/settings", response_model=AISettingsOut, tags=["ai"])
    def put_settings(b: AISettingsIn, p=Depends(c.principal), s=Depends(c.db)):
        """Admin+. External processing sends document text to a third party: requires explicit acknowledgement."""
        c.need(p, "admin")
        if b.external_enabled and (b.provider == "stub" or not b.acknowledge_external_processing):
            raise c.ApiError(422, "AI_OPT_IN_REQUIRED", "Set provider=openai_compatible and acknowledge_external_processing=true")
        st = s.get(OrgAISettings, p.org_id) or OrgAISettings(org_id=p.org_id, updated_by=p.user_id)
        st.external_enabled, st.provider, st.updated_by = b.external_enabled, b.provider if b.external_enabled else "stub", p.user_id
        s.add(st); c.audit(s, p.org_id, p.user_id, "ai.settings", p.org_id, details=b.model_dump()); s.commit()
        return sout(st)
