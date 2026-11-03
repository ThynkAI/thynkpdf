# Frontend/UX audit tooling (Bot 2) — see docs/audit/

Not part of the default test run. Everything here talks to a REAL local FastAPI backend; nothing is mocked.

```bash
# backend with a fresh DB (port 8123) + web build pointed at it (port 3123)
python packages/frontend-tests/audit/make_audit_fixtures.py        # real fixture PDFs -> audit/fixtures/
AUDIT_COMMIT=$(git rev-parse HEAD) THYNKPDF_API_URL=http://localhost:8123 \
  npx playwright test -c audit/audit.config.ts                    # from packages/frontend-tests
THYNKPDF_API_URL=http://localhost:8123 npx playwright test -c audit/baseline.config.ts   # existing e2e on :3123
python packages/frontend-tests/audit/verify_outputs.py /tmp/verify # independent pypdf/pikepdf/pdftotext check of server versions
```
- `frontend.audit.spec.ts`: tests named `FUX-xx known-failing` use `test.fail()` and reproduce confirmed defects (they report "passed" while the defect exists, and "Expected to fail, but passed" once fixed).
- The live E2E/unit suites need a pre-registered user `dev@thynkpdf.dev` / `ThynkDev-2026!` (POST /auth/register with `org_name`); a fresh DB has none.
- `probes/`: one-off exploratory scripts used for the report (desktop via Electron `--remote-debugging-port`, CDP). Kept for reproducibility.
