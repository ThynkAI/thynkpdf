"""Start the THYNKPDF API without needing PYTHONPATH: `python scripts/serve_api.py [--port 8000]`.
Settings come from <repo>/.env (see installers/) or real environment variables."""
import os, sys, argparse
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
for p in ["apps/api", "apps/worker", "packages/pdf-engine", "packages/storage", "packages/signatures", "packages/ai"]:
    sys.path.insert(0, os.path.join(ROOT, p))
os.chdir(ROOT)
if __name__ == "__main__":
    ap = argparse.ArgumentParser(); ap.add_argument("--host", default="127.0.0.1"); ap.add_argument("--port", type=int, default=8000)
    a = ap.parse_args()
    import uvicorn
    uvicorn.run("thynkpdf_api.main:app", host=a.host, port=a.port)
