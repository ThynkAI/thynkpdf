"""Desktop schema management (BD-04 / BD-07): bring the local SQLite library to the Alembic head safely.

1. quick_check the DB (corrupt -> MigrationError, file untouched).
2. Old desktop DBs were built by SQLAlchemy create_all (no alembic_version): add any missing tables the old way,
   verify every table/column matches the current models, then stamp the head revision.
3. Before any upgrade (or stamp) copy the DB with SQLite's online backup API to backups/ (keeps the last 5).
4. alembic upgrade head. A DB from a newer THYNKPDF (unknown revision) is refused, never downgraded.
On any failure the original DB file is left as it was and a MigrationError with a user-facing message is raised.
"""
import os, sqlite3, time
from pathlib import Path


class MigrationError(Exception):
    pass


def _alembic_cfg(db_path: Path, script_location: Path):
    from alembic.config import Config
    cfg = Config()
    cfg.set_main_option("script_location", str(script_location))
    cfg.set_main_option("sqlalchemy.url", "sqlite:///" + db_path.as_posix())
    return cfg


def _backup(db_path: Path, tag: str, keep=5) -> Path:
    bdir = db_path.parent / "backups"; bdir.mkdir(mode=0o700, exist_ok=True)
    dst = bdir / f"thynkpdf-{tag}-{time.strftime('%Y%m%d-%H%M%S')}.db"
    src = sqlite3.connect(db_path); out = sqlite3.connect(dst)
    try: src.backup(out)
    finally: out.close(); src.close()
    os.chmod(dst, 0o600)
    for old in sorted(bdir.glob("thynkpdf-*.db"))[:-keep]: old.unlink(missing_ok=True)
    return dst


def migrate(db_path: Path, script_location: Path) -> dict:
    from alembic import command
    from alembic.script import ScriptDirectory
    from sqlalchemy import create_engine, inspect
    from .db import Base
    cfg = _alembic_cfg(db_path, script_location)
    head = ScriptDirectory.from_config(cfg).get_current_head()
    known = {r.revision for r in ScriptDirectory.from_config(cfg).walk_revisions()}
    fresh = not db_path.exists() or db_path.stat().st_size == 0
    os.environ["THYNKPDF_DATABASE_URL"] = "sqlite:///" + db_path.as_posix()  # read by migrations/env.py
    if fresh:
        command.upgrade(cfg, "head"); os.chmod(db_path, 0o600)
        return {"action": "created", "revision": head}
    try:
        con = sqlite3.connect(f"file:{db_path.as_posix()}?mode=ro", uri=True)
        try:
            ok = con.execute("PRAGMA quick_check").fetchone()[0]
            tables = {r[0] for r in con.execute("select name from sqlite_master where type='table'")}
            rev = con.execute("select version_num from alembic_version").fetchone()[0] if "alembic_version" in tables else None
        finally: con.close()
    except sqlite3.DatabaseError as e:
        raise MigrationError(f"Your library database could not be read ({e}). It was not changed.") from e
    if ok != "ok": raise MigrationError(f"Your library database failed its integrity check ({ok}). It was not changed.")
    if rev and rev not in known:
        raise MigrationError("Your library was saved by a newer version of THYNKPDF. Install the latest version; your data was not changed.")
    if rev == head: return {"action": "none", "revision": head}
    backup = _backup(db_path, rev or "create_all")
    try:
        if rev is None:  # legacy create_all DB
            eng = create_engine("sqlite:///" + db_path.as_posix())
            try:
                Base.metadata.create_all(eng)  # what every older desktop launch did: add missing tables only
                insp = inspect(eng)
                for t in Base.metadata.sorted_tables:
                    have = {c["name"] for c in insp.get_columns(t.name)}
                    missing = {c.name for c in t.columns} - have
                    if missing: raise MigrationError(f"Library table {t.name} is missing columns {sorted(missing)}; it cannot be upgraded automatically.")
            finally: eng.dispose()
            command.stamp(cfg, "head")
        else:
            command.upgrade(cfg, "head")
    except MigrationError as e:
        raise MigrationError(f"{e} Your data is unchanged; a backup is at {backup}.") from e
    except Exception as e:
        raise MigrationError(f"THYNKPDF could not update your library ({type(e).__name__}: {e}). A backup made just before is at {backup}.") from e
    return {"action": "stamped" if rev is None else "upgraded", "from": rev, "revision": head, "backup": str(backup)}
