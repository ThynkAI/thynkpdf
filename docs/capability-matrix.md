# THYNKPDF Backend Capability Matrix
Updated 2026-10-31. Evidence: `python -m pytest` (11 passed), live uvicorn+curl smoke run. Nothing is INTEGRATED/ACCEPTED until THYNKPDF1 uses it on real documents.

| Area | Feature | Status | Evidence / notes |
|---|---|---|---|
| Auth | Register/login/refresh JWT (HS256), access+refresh typ check | TESTED | test_auth_required_and_bad_tokens |
| Auth | Orgs, owner/admin/member/viewer roles, add member | TESTED | test_viewer_cannot_write |
| Auth | Tenant-scoped queries (org_id on every doc/version query) | TESTED | test_cross_tenant_denied (2 orgs, 11 read+write paths) |
| Auth | MFA, session revocation list, rate limiting, invite emails | NOT STARTED | |
| Auth | Postgres RLS | NOT STARTED | app-level only today |
| Docs | Upload: magic bytes, size limit, sha256, parse check | TESTED | test_bad_uploads, vertical slice |
| Docs | Immutable versions + optimistic concurrency (expected_version, CAS update + unique(doc,number)) | TESTED | test_version_conflict |
| Docs | List/get/versions, download current, download version w/ HTTP Range | TESTED | test_page_ops_and_range |
| Docs | Rollback, soft-delete recovery, retention, quotas | NOT STARTED | schema has deleted_at |
| Storage | LocalStorage (key validation, root confinement, write-once) | TESTED | test_path_traversal |
| Storage | S3/MinIO adapter | IMPLEMENTED | untested: no MinIO on box |
| Engine | Metadata/inspect (pages, geometry, rotation, fonts, annots, forms, sigs, JS, attachments) | TESTED | |
| Engine | Per-document capability report (fonts actually used) | TESTED | test_edit_limitations |
| Pages | Rotate, reorder, extract, merge, split | TESTED | verified with pypdf + pdftotext |
| Pages | Insert/delete/duplicate/crop/resize/blank/watermark/header/footer/numbers/bookmarks | NOT STARTED | |
| Edit | text_replace via content-stream operator rewrite (Std-14 unembedded Type1, simple encoding, single run) | TESTED | reopened with pypdf + poppler; old text absent |
| Edit | text_insert/delete, font change, image ops, link change | NOT STARTED | API returns EDIT_OP_NOT_IMPLEMENTED |
| Edit | Embedded/subset/CID fonts, cross-run matches | BLOCKED (by design) | returns EDIT_NOT_SUPPORTED with limitations |
| Compress | low/balanced/high lossless presets (pikepdf/qpdf) + size report; keeps original if not smaller | TESTED | test_compress; CUSTOM + image downsampling NOT STARTED |
| OCR | ocrmypdf/tesseract | BLOCKED | apt mirrors unreachable on box (500/unsigned InRelease); Dockerfile installs tesseract |
| Jobs | Job table, GET /jobs/{id}, DB-polling worker skeleton | IN PROGRESS | no endpoint enqueues yet |
| DB | Alembic initial migration, upgrade/downgrade/upgrade on SQLite | TESTED | MIGRATION_ROUNDTRIP_OK; Postgres untested |
| Infra | docker-compose (Postgres/Redis/MinIO/api/worker), .env.example | IMPLEMENTED | docker unavailable; never run |
| Forms | XFA: detect (stream + packet array; none/hybrid/dynamic; scripts counted), read datasets, template field schema, fill (hybrid = AcroForm + datasets in sync; dynamic = datasets), XML export/import, convert to AcroForm (hybrid: strip XFA; dynamic: generated pages + widgets from template, pre-filled), flatten on XFA | TESTED | test_xfa.py (16 tests, original fixtures from make_xfa_fixtures.py); XFA scripts never executed; defusedxml + lxml(resolve_entities=False,no_network) with size/node/depth caps. Limits: repeating subforms (occur) once, lr-tb/table as top-down, pageSet/master pages, draw graphics/images, button/image/barcode fields not converted; rich text flattened to plain |
| Conversion, Forms, Signatures, Redaction, AI, Billing | — | NOT STARTED | |
| Audit | audit_events written on auth/doc ops | IMPLEMENTED | no read API |


## Phase 2 update (2026-10-31, branches feat/backend-phase2 → -annotations-forms → -signing-audit → -docmgmt → -ai)
| Area | Feature | Status | Evidence |
|---|---|---|---|
| Auth | httpOnly refresh cookie `thynkpdf_rt`, rotation (replay → TOKEN_REVOKED), logout | TESTED | test_refresh_cookie_rotation_logout |
| Docs | POST /documents/{id}/versions (client bytes, same validation) | TESTED | test_upload_new_version_multipart |
| Edit | text_insert / text_delete / text_move (content-stream ops) | TESTED | pdftotext + pypdf positions |
| Pages | delete / duplicate / insert-blank / insert-from | TESTED | |
| Annotations | 11 types with /AP, batch add/update/delete, threads (/IRT, state) | TESTED | pypdf reopen |
| Forms | create/delete fields, fill (JSON/CSV), flatten, export | TESTED | pypdf get_fields, pdftotext after flatten |
| Signatures | visual assets + versioned placement | TESTED | image XObject present after reopen |
| Signatures | e-sign requests, order, consent, hash-chained events, auto-finalize | TESTED | chain tamper test |
| Signatures | pyHanko sign/verify (dev cert untrusted) | TESTED | byte-tamper → intact=false |
| Signatures | email notifications / reminders | BLOCKED | no email provider configured |
| Signatures | TSA timestamps, trusted CA cert | BLOCKED | needs approved TSA + CA-issued cert |
| Audit | org audit + per-document audit trail | TESTED | |
| DocMgmt | folders, tags, star, trash/restore/purge, shares (user+link), restore version | TESTED | |
| AI | ask/summarize with page citations (stub extractive), opt-in external provider, rate limit | TESTED (stub only) | real LLM provider untested |
| OCR | ocrmypdf/tesseract | BLOCKED | apt mirrors unreachable on box |
| Billing | — | DROPPED | THYNKPDF is free |
