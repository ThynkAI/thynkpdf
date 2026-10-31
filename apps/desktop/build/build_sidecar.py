"""Build the backend sidecar with PyInstaller (one-dir) into apps/desktop/sidecar/thynkpdf-server/.
Bundles the static web export (apps/web/out) and the launcher. Run from any cwd with the repo venv:
    python apps/desktop/build/build_sidecar.py
"""
import os, shutil, subprocess, sys
from pathlib import Path
ROOT = Path(__file__).resolve().parents[3]; DESK = ROOT / "apps/desktop"
WEB = ROOT / "apps/web/out"
if not (WEB / "index.html").exists(): sys.exit("apps/web/out missing: run `THYNKPDF_STATIC_EXPORT=1 NEXT_PUBLIC_API_URL= pnpm --filter @thynkpdf/web build` first")
paths = ["apps/api", "packages/pdf-engine", "packages/storage", "packages/signatures", "packages/ai"]
sep = os.pathsep
args = [sys.executable, "-m", "PyInstaller", "--noconfirm", "--clean", "--onedir", "--name", "thynkpdf-server",
        "--distpath", str(DESK / "sidecar"), "--workpath", str(DESK / "build/.pyi-work"), "--specpath", str(DESK / "build/.pyi-work"),
        "--add-data", f"{WEB}{sep}web", "--add-data", f"{DESK / 'launcher'}{sep}launcher",
        "--collect-submodules", "thynkpdf_api", "--collect-submodules", "uvicorn", "--collect-data", "pyhanko",
        "--collect-data", "pyhanko_certvalidator", "--collect-data", "reportlab", "--copy-metadata", "pyhanko",
        "--hidden-import", "thynkpdf_engine", "--hidden-import", "thynkpdf_storage", "--hidden-import", "thynkpdf_signatures",
        "--hidden-import", "thynkpdf_ai", "--hidden-import", "email_validator", "--hidden-import", "multipart",
        "--hidden-import", "python_multipart", "--exclude-module", "tkinter", "--exclude-module", "pytest"]
for p in paths: args += ["--paths", str(ROOT / p)]
args.append(str(DESK / "server/desktop_server.py"))
subprocess.run(args, check=True)
print("sidecar:", DESK / "sidecar/thynkpdf-server")
