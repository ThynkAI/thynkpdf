from datetime import datetime
from fastapi import Depends
from pydantic import BaseModel
from sqlalchemy import select
from ..db import AuditEvent


class AuditOut(BaseModel):
    id: str; action: str; user_id: str | None; target: str | None; created_at: str


def register(app, c):
    @app.get("/audit", response_model=list[AuditOut], tags=["audit"])
    def audit(action: str | None = None, target: str | None = None, user_id: str | None = None, since: datetime | None = None,
              until: datetime | None = None, limit: int = 100, offset: int = 0, p=Depends(c.principal), s=Depends(c.db)):
        """Org-scoped audit trail (admin+). `action` matches a prefix, e.g. `document.` or `auth.login`."""
        c.need(p, "admin")
        q = select(AuditEvent).where(AuditEvent.org_id == p.org_id)
        if action: q = q.where(AuditEvent.action.startswith(action))
        if target: q = q.where(AuditEvent.target == target)
        if user_id: q = q.where(AuditEvent.user_id == user_id)
        if since: q = q.where(AuditEvent.created_at >= since)
        if until: q = q.where(AuditEvent.created_at <= until)
        rows = s.scalars(q.order_by(AuditEvent.created_at.desc()).limit(min(max(limit, 1), 500)).offset(max(offset, 0)))
        return [AuditOut(id=r.id, action=r.action, user_id=r.user_id, target=r.target, created_at=r.created_at.isoformat()) for r in rows]
