# Backend/desktop audit diagnostics (Bot 1, 2026-11-01)
Synthetic data only. Everything binds 127.0.0.1 on OS-chosen ports.

| Script | Stage | What it does |
|---|---|---|
| `make_corpus.py` | 5 | Builds the synthetic corpus into `corpus/` (gitignored): std-14 text, two-run text, accented, embedded subset TTF, CID/CJK, mixed sizes, rotated, AcroForm, image-only scan, image-heavy, annotations+links+bookmarks+attachment+JS, encrypted (user / owner-only), truncated, garbage, no-pages, 512 MiB flate bomb, 2000-page doc, XFA with XXE. |
| `engine_checks.py` | 5 | Runs `thynkpdf_engine` ops on the corpus and validates with PyMuPDF/MuPDF, pypdf, poppler `pdftotext`. Writes `engine_results.json`. |
| `sidecar.py` | — | Helper to drive a packaged `thynkpdf-server` headless. |
| `first_run.py` | 2,3,6 | Fresh HOME first run of a packaged sidecar: users, auth, upload/edit/download, share/sign routes, Host/Origin probes, brute-force, restart + port change, file modes. |
| `upgrade_recovery.py` | 4 | v0.1.0 data → v0.1.5 sidecar, Alembic on desktop DB, missing object, read-only storage, SIGKILL mid-merge, corrupt DB. |
| `perf.py` | 8 | Startup, RSS, op duration, `/health` latency during merge/compress/bomb. Writes `perf_results.json`. |

Regression tests that encode the findings: `packages/backend-tests/audit/test_audit_regressions.py` (not in default `testpaths`).

```bash
python3 -m venv .venv && . .venv/bin/activate && pip install -r requirements.txt pymupdf   # pymupdf = independent validator only (AGPL; test-time, never shipped)
gh release download v0.1.5 -p '*.AppImage' && ./THYNKPDF-0.1.5.AppImage --appimage-extract
SC=$PWD/squashfs-root/resources/thynkpdf-server/thynkpdf-server
python tools/audit/make_corpus.py && python tools/audit/engine_checks.py
python tools/audit/first_run.py $SC /tmp/tp-first
python tools/audit/upgrade_recovery.py <v0.1.0 sidecar> $SC /tmp/tp-upgrade
python tools/audit/perf.py $SC
THYNKPDF_AUDIT_SIDECAR=$SC python -m pytest -q -p no:cacheprovider packages/backend-tests/audit
```
