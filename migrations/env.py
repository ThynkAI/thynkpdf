import os
from alembic import context
from sqlalchemy import engine_from_config, pool
from thynkpdf_api.db import Base
cfg = context.config
if os.getenv("THYNKPDF_DATABASE_URL"): cfg.set_main_option("sqlalchemy.url", os.environ["THYNKPDF_DATABASE_URL"])
eng = engine_from_config(cfg.get_section(cfg.config_ini_section), prefix="sqlalchemy.", poolclass=pool.NullPool)
with eng.connect() as c:
    context.configure(connection=c, target_metadata=Base.metadata, render_as_batch=True)
    with context.begin_transaction(): context.run_migrations()
