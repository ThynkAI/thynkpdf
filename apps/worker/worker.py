"""THYNKPDF worker (IN PROGRESS). Claims queued rows from `jobs` (DB-polling; swap for Redis/RQ or Celery in prod)
and dispatches to engine handlers. No API endpoint enqueues jobs yet — all page ops are synchronous."""
import json, time
from sqlalchemy import select, update
from thynkpdf_api.config import settings
from thynkpdf_api.db import make_session_factory, Job

HANDLERS = {}  # kind -> callable(session, job) -> result dict

def run_once(S) -> bool:
    with S() as s:
        j = s.scalar(select(Job).where(Job.status == "queued").order_by(Job.created_at).limit(1))
        if not j: return False
        if s.execute(update(Job).where(Job.id == j.id, Job.status == "queued").values(status="running")).rowcount != 1:
            s.rollback(); return True
        s.commit()
        try:
            h = HANDLERS[j.kind]; j.result = json.dumps(h(s, j)); j.status, j.progress = "succeeded", 100
        except KeyError: j.status, j.error_code = "failed", "JOB_KIND_UNSUPPORTED"
        except Exception: j.status, j.error_code = "failed", "JOB_FAILED"
        s.commit(); return True

if __name__ == "__main__":
    S = make_session_factory(settings.database_url)
    while True:
        if not run_once(S): time.sleep(1)
