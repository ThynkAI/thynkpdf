"""Run `alembic upgrade head` with the repo paths set (used by the installers)."""
import os, sys
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
os.chdir(ROOT); sys.path.insert(0, os.path.join(ROOT, "apps/api"))
import thynkpdf_api.config  # noqa: F401  loads .env so alembic sees THYNKPDF_DATABASE_URL
from alembic.config import main
main(argv=["-c", os.path.join(ROOT, "alembic.ini"), "upgrade", "head"])
