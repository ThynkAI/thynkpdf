import json, os, sys, tempfile
root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path[:0] = [os.path.join(root, p) for p in ("apps/api", "packages/pdf-engine", "packages/storage", "packages/signatures", "packages/ai")]
tmp = tempfile.mkdtemp()
from thynkpdf_api.main import create_app
spec = create_app(f"sqlite:///{tmp}/o.db", f"{tmp}/obj").openapi()
json.dump(spec, open(os.path.join(root, "docs/openapi.json"), "w"), indent=1, sort_keys=True)
print(spec["openapi"], len(spec["paths"]), "paths")
