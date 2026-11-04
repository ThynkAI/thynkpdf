# Backend test results — Bot 1 (backend / desktop / security / release)

- **Audited branch / commit:** `origin/main` = `7604fc5103ee35976c55bd72dc42922f9aa3d992` (tag `v0.1.6`, the current "Latest" release). Audit branch `audit/backend-desktop` is based on it.
- **Release binaries exercised:** `THYNKPDF-0.1.5.AppImage` (tag `v0.1.5` = `e6c51a430b4a8ead0e7d042f46c009c1a23aaf9a`, sha256 `b27edfb9…c7d69fed`, matches the GitHub asset digest) and `THYNKPDF-0.1.0.AppImage` (tag `v0.1.0` = `631d3f87…`, sha256 `b71d1e05…abf0c3c0`) for the upgrade test. The v0.1.6 sidecar binary was also probed read-only for route count.
- `git diff e6c51a4 7604fc5` touches only 4 web/desktop-icon files, so backend findings on 7604fc5 apply to v0.1.5.
- **Date:** 2026-11-01, run between 00:08 and ~01:00 America/Toronto (EDT).
- **Environment:** Debian 13 (trixie) x86_64, kernel 6.12, Python 3.13.5 venv (CI uses 3.12, so this is not the CI interpreter). Packages from `requirements.txt` (fastapi 0.162.0, pikepdf 10.17.0, pyHanko 0.38.0, pypdf 6.21.4, SQLAlchemy 2.1.6, pytest 9.2.0), plus PyMuPDF 2.0 (MuPDF 1.28.5), installed only as an independent validator. It is AGPL: test-time only, never shipped. Also poppler `pdftotext`/`pdftoppm` and Xvfb. No tesseract, qpdf CLI or mutool. No Docker, Postgres or MinIO.
- **Ports used:** OS-assigned ephemeral ports on 127.0.0.1 only. 3000/8000/8001 were never touched.

## 1. Existing backend suite
```bash
python3 -m venv /workspace/.venv-audit && . /workspace/.venv-audit/bin/activate
pip install -r requirements.txt pymupdf
python packages/backend-tests/make_fixtures.py && python packages/backend-tests/make_xfa_fixtures.py
python -m pytest -q -p no:cacheprovider
```
| Run | Result | Duration |
|---|---|---|
| Regenerated fixtures | **85 passed**, 0 failed, 237 warnings (Starlette httpx deprecation, pypdf `Page.images` deprecation, a pikepdf PageCopyWarning in `test_forms_create_fill_export_flatten`, which is the same root cause as BD-10) | 165 s |
| Committed fixtures (`git checkout -- packages/backend-tests/fixtures`) | **85 passed** | 164 s |

Notes:
- `make_fixtures.py` / `make_xfa_fixtures.py` are **not byte-deterministic**: they rewrote all 13 committed fixtures (timestamps/IDs). Restored before committing (BD-24).
- The capability matrix still says "11 passed" (outdated doc, BD-24).
- **No CI workflow runs this suite.** `desktop-release.yml` and `web-e2e.yml` contain no `pytest` step (BD-03). Other than this local run, there is no evidence of these 85 tests passing for any released commit.

## 2. Audit regression tests (new): `packages/backend-tests/audit/test_audit_regressions.py`
```bash
python tools/audit/make_corpus.py
THYNKPDF_AUDIT_SIDECAR=/workspace/audit-bin/x0.1.5/squashfs-root/resources/thynkpdf-server/thynkpdf-server \
  python -m pytest -q -p no:cacheprovider packages/backend-tests/audit
```
**Result: 9 failed, 4 passed (5.4 s).** The failures are intended. Each one reproduces a finding:

| Test | Result | Finding |
|---|---|---|
| test_source_registers_feature_routes | PASS | baseline |
| test_BD01_packaged_sidecar_registers_same_routes_as_source | **FAIL**: 47 routes missing | BD-01 |
| test_BD05_sidecar_rejects_foreign_host_header | **FAIL**: `Host: attacker.example` → 200 | BD-05 |
| test_BD04_desktop_db_is_migration_managed | **FAIL**: no `alembic_version` | BD-04 |
| test_BD08_move_text_does_not_shift_following_run | **FAIL** | BD-08 |
| test_BD09_duplicate_page_keeps_annotations | **FAIL** | BD-09 |
| test_BD10_page_ops_keep_document_level_structures[reorder/extract/merge] | **FAIL** ×3 | BD-10 |
| test_BD10b_reorder_keeps_acroform | **FAIL** | BD-10 |
| test_compress_never_grows_file | PASS | verified |
| test_signed_doc_detected_and_edit_invalidates | PASS | verified |
| test_xfa_xxe_rejected | PASS | verified |

## 3. Packaged sidecar diagnostics (v0.1.5 AppImage, extracted, fresh HOME)
Raw output is in `tools/audit/first_run_results_v0.1.5.json`, `tools/audit/upgrade_recovery_results.json`, `tools/audit/perf_results.json` and `tools/audit/engine_results.json`.

| Check | Result |
|---|---|
| AppImage GUI under `xvfb-run` with a fresh HOME | Window opens, sidecar READY, home screen rendered (`docs/audit/evidence/v0.1.5-linux-first-launch.png`). The right panel says "Editing requires a document opened through the THYNKPDF server (sign in, then open)". |
| Sidecar cold start (fresh data dir) / warm | 1.03–1.11 s / 0.98 s to `THYNKPDF_READY` |
| Users after first start | **0**. No `alembic_version` table |
| `GET /documents` without token | 401 AUTH_REQUIRED |
| Login with no accounts | 401 INVALID_CREDENTIALS |
| Shipped web bundle calls `/auth/register` | **No** (grep of `_internal/web/_next`: 0 hits; source `SignInForm.tsx` is sign-in only) |
| Register via raw API → upload → rotate → text_replace → download | 201 / 201 / 200 (v2) / 200 (v3) / 200 |
| Route count packaged vs source | **23 vs 74** (v0.1.0, v0.1.5 and v0.1.6 binaries all 23) |
| `POST /documents/{id}/shares`, `POST /signature-requests` | **405** (route absent) |
| `Host: attacker.example` | 200 accepted |
| `POST /auth/register` with `Origin`/`Host` = attacker.example | 201 |
| 30 wrong-password logins | 30× 401, no lockout or delay |
| Restart (new random port) → refresh token → list docs → versions | port changed; refresh 200; 1 doc; 3 versions |
| File modes (umask 022) | data dir 0755, DB 0644, objects 0755, jwt-secret 0600 |
| v0.1.0 data dir opened by v0.1.5 | login 200, versions [upload, rotate], download 200 (no schema change between these tags) |
| `scripts/migrate.py` (alembic upgrade head) on a desktop DB | **rc=1** `table audit_events already exists` |
| Fresh Alembic DB vs desktop `create_all` DB | identical tables/columns today |
| Missing storage object → download / rotate / list | 500 INTERNAL_ERROR / 500 / 200 |
| Read-only objects dir → upload / rotate | 500 / 500; current_version unchanged (no partial version) |
| SIGKILL 0.4 s into a 4×2000-page merge → restart | integrity_check ok; 0 DB rows without object; 0 orphan/tmp files; journal_mode=delete |
| Corrupt `thynkpdf.db` | sidecar exits 1 before READY (Electron shows "engine stopped (code 1)" and quits). No recovery |
| Merge 2×2000 pages | 1.41 s, peak RSS 153 MiB, `/health` max latency 863 ms |
| Merge 4×2000 pages (8000 > MAX_PAGES 5000) | 400 after 4.3 s of work |
| Compress 2000 pages (balanced) | 1.02 s, peak 186 MiB |
| 0.5 MiB flate bomb (512 MiB inflated) compress "high" | 200 after 9.0 s; **`/health` blocked 8.9 s**. In-process run peaked at ~1.2 GiB RSS |
| Idle sidecar RSS | 98 MiB |

## 4. Engine corpus results (`tools/audit/engine_checks.py`, source at 7604fc5)
PASS: Std-14 replace (verified with pypdf + pdftotext), move whole run, relative rotate on /Rotate pages, AcroForm fill (pypdf), flatten (value in page text, 0 fields left), pyHanko sign + verify (intact, untrusted self-signed), signed detection, XXE → `XFA_UNSAFE_XML`, compress keeps original when output is larger.
FAIL: move side-effect (BD-08), duplicate annotations (BD-09), reorder/extract/merge structure loss (BD-10).
INFO: embedded/CID replace → EDIT_NOT_SUPPORTED (safe refusal); insert `Łódź` and `日本` → EDIT_UNSUPPORTED_CHARACTERS (WinAnsi only); truncated PDF opens via qpdf repair; owner-password-only PDF opens; image-only scan opens, no OCR, no tesseract (BD-12); preset sizes in BD-13; 2000-page inspect 0.47 s, merge 1.03 s.

## 5. CI evidence cited (not re-run)
- `desktop-release` run **41262051796** (tag v0.1.5 @ e6c51a43, 2026-10-31 21:40 EDT): all 4 build jobs succeeded. `SIDECAR_SMOKE_OK` was logged on ubuntu, windows, macos-latest (arm64) and macos-15-intel. The mac verify step ran (codesign ad-hoc; `spctl` rejection is expected). The Intel job set `MACOSX_DEPLOYMENT_TARGET: 15.0`.
- `desktop-release` run **41268428967** (tag v0.1.6 @ 7604fc51): success.
- **No `web-e2e` run exists for e6c51a43 or 7604fc51.** web-e2e triggers only on pull_request/workflow_dispatch. The nearest runs are on PR heads 89606d2a and 9f3f6312, which are not the tagged commits.
- What smoke_sidecar.py covers: `/health`, launcher HTML, `/` HTML, register, and one upload. It does not cover any feature route, migration, upgrade, Electron launch or installer.

## 6. Not run / blocked
Windows and macOS installers (no runners here). Electron UI flows beyond the first screenshot (Bot 2). Postgres, MinIO, docker-compose. OCR (not implemented). A real LLM provider. Email (none exists). A second physical device for share links. Real disk-full (simulated with a read-only dir). Multi-OS-user on one machine (only file modes were checked).
