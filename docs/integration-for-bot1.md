# THYNKPDF backend — integration guide for THYNKPDF1 (frontend)
Contract: `docs/openapi.json` (OpenAPI 3.1, 22 paths). Generate a typed client, e.g. `npx openapi-typescript docs/openapi.json -o apps/web/src/api/schema.d.ts`.
Base URL (dev): `http://localhost:8000`. CORS allows `http://localhost:3000` (env `THYNKPDF_CORS_ORIGINS`, comma-separated), credentials allowed; exposed headers: `Content-Range, Accept-Ranges, Content-Length, ETag, X-Document-Version`.

## Run locally
```bash
cd /workspace/thynkpdf && . .venv/bin/activate
export PYTHONPATH=apps/api:packages/pdf-engine:packages/storage THYNKPDF_DATABASE_URL=sqlite:///./dev.db THYNKPDF_JWT_SECRET=dev-only-secret-change-me-0123456789abcdef
uvicorn thynkpdf_api.main:app --port 8000
```
Dev test account (in `dev.db` only): `dev@thynkpdf.dev` / `ThynkDev-2026!` (org "THYNKPDF Dev", role owner). Dev-only; never reuse.

## Auth flow
1. `POST /auth/register {email,password(>=10),org_name}` → 201 creates user + org (owner).
2. `POST /auth/login {email,password,org_id?}` → `{access_token, refresh_token, token_type:"bearer", expires_in}` (access 900 s, refresh 14 d).
3. Send `Authorization: Bearer <access_token>` on every call.
4. On 401 `TOKEN_EXPIRED` → `POST /auth/refresh {refresh_token}` → same token shape. Refresh tokens cannot be used as access tokens.
5. `GET /auth/me` → `{user_id, org_id, role}`. Tokens are org-scoped; switch org by logging in with `org_id`.
Roles: viewer (read), member (upload/modify), admin (+ `POST /orgs/members`), owner.

## Documents & versions
- `POST /documents/upload` multipart field `file` → 201 `{document_id, version_id, version, sha256, size, page_count}`.
- `GET /documents`, `GET /documents/{id}` → `{document_id, filename, current_version, version_id, created_at}`.
- `GET /documents/{id}/versions` → list of `{version_id, number, sha256, size, operation, parent_version_id, created_at}`. Versions are immutable.
- `GET /documents/{id}/versions/{version_id}/file` and `GET /documents/{id}/download` (current) stream `application/pdf`, support `Range: bytes=a-b` → 206 + `Content-Range` (416 if unsatisfiable). `ETag` = sha256. Works with PDF.js range loading (pass the Authorization header via `httpHeaders`).

## PDF operations (synchronous; each returns the new version)
All modifying ops on an existing doc require `expected_version` (= `current_version` you hold). Mismatch → 409 `VERSION_CONFLICT` with `details.current_version`; refetch and retry.
| Endpoint | Body | Result |
|---|---|---|
| POST /pdf/pages/rotate | `{document_id, expected_version, pages?:[1..], angle:90\|180\|270\|-90}` | VersionResult |
| POST /pdf/pages/reorder | `{document_id, expected_version, order:[permutation]}` | VersionResult |
| POST /pdf/edit | `{document_id, expected_version, operations:[EditOp], revision_note?}` | VersionResult (`report.applied`) |
| POST /pdf/compress | `{document_id, expected_version, preset:low\|balanced\|high, strip_metadata?}` | VersionResult; `report` = original_size, final_size, compression_ratio, duration_ms, warnings, new_version_created |
| POST /pdf/pages/extract | `{document_id, pages:[..], filename?}` | NEW document (201 UploadOut) |
| POST /pdf/merge | `{document_ids:[2..50], filename?}` | NEW document |
| POST /pdf/split | `{document_id, ranges:[[start,end],..]}` | list of NEW documents |
VersionResult = `{document_id, version_id, version, sha256, size, report}`. Page numbers are 1-based.

EditOp: `{op, page, object_id?, bbox?, find?, replacement?, occurrence:"all"|"first", formatting?}`. Only `op:"text_replace"` is implemented: it rewrites the string operands of text-showing operators in the page content stream (no overlays). Others → 422 `EDIT_OP_NOT_IMPLEMENTED`.

## Capability model — call before showing edit UI
`GET /pdf/{id}/capabilities` →
```json
{"document_id":"..","version":2,"version_id":"..",
 "page_ops":{"rotate":true,"reorder":true,"extract":true,"split":true,"merge":true},
 "compress":true,"text_replace":true,
 "document_limitations":[{"code":"SIGNED_DOCUMENT|PDFA|ROLE_READ_ONLY","message":".."}],
 "pages":[{"number":1,"text_replace":true,"editable_fonts":["/F1"],
           "limitations":[{"code":"FONT_NOT_SIMPLE_TYPE1|FONT_EMBEDDED_SUBSET_RISK|FONT_NOT_STANDARD_14|FONT_CUSTOM_ENCODING|NO_TEXT_LAYER","message":"..","font":"/F2"}]}],
 "safe_alternatives":["ocr (when text layer absent)","annotations/comments","replace page via merge"]}
```
Text replace works only when the text is drawn in one run with a standard-14 unembedded Type1 font in WinAnsi/Standard/MacRoman encoding and the characters are cp1252-representable. Matches split across runs/kerning arrays return `TEXT_NOT_FOUND` (`details.hint`). Show the limitation; do not fake the edit client-side.
`GET /pdf/{id}/metadata?version=N` → page_count, pdf_version, info, pages[{number,width,height,rotation,annotations,fonts,images}], has_acroform, has_signatures, has_javascript, attachments, is_linearized.

## Errors
Always `{"error":{"code","message","details"}}`.
| HTTP | code |
|---|---|
| 401 | AUTH_REQUIRED, TOKEN_INVALID, TOKEN_EXPIRED, INVALID_CREDENTIALS |
| 403 | FORBIDDEN_ROLE, NOT_A_MEMBER, ORG_SUSPENDED |
| 404 | DOCUMENT_NOT_FOUND (also for other tenants' docs), VERSION_NOT_FOUND, JOB_NOT_FOUND |
| 409 | VERSION_CONFLICT, EMAIL_TAKEN, ALREADY_MEMBER |
| 413 | FILE_TOO_LARGE (`details.max_bytes`, default 100 MB) |
| 415 | INVALID_FILE_TYPE |
| 422 | VALIDATION_ERROR, PDF_MALFORMED, PDF_ENCRYPTED, EDIT_NOT_SUPPORTED, TEXT_NOT_FOUND, EDIT_UNSUPPORTED_CHARACTERS, EDIT_OP_NOT_IMPLEMENTED |
| 400 | INVALID_PAGE, INVALID_ORDER, INVALID_RANGE, INVALID_ANGLE, INVALID_PRESET, INVALID_REQUEST |
| 500 | INTERNAL_ERROR (no internals leaked) |

## Job model (async — contract for later; nothing enqueues yet)
Large docs / OCR / conversion will return `202 {"job_id"}`. Poll `GET /jobs/{id}` →
`{job_id, kind, status: queued|running|succeeded|failed|cancelled, progress:0-100, result:{document_id,version_id,...}|null, error_code|null, created_at}`. Jobs are tenant-scoped (other org → 404). Today all ops above are synchronous.

## Fixtures
`packages/backend-tests/fixtures/*.pdf` (regenerate: `python packages/backend-tests/make_fixtures.py`): simple-3page.pdf (editable text "Invoice Number ACME-00N", "Page marker PN"), simple-1page.pdf, embedded-font.pdf (not editable), no-text.pdf (no text layer), malformed.pdf, not-a-pdf.pdf.

## curl
```bash
T=$(curl -s -X POST localhost:8000/auth/login -H 'content-type: application/json' -d '{"email":"dev@thynkpdf.dev","password":"ThynkDev-2026!"}' | jq -r .access_token)
D=$(curl -s -H "Authorization: Bearer $T" -F file=@packages/backend-tests/fixtures/simple-3page.pdf localhost:8000/documents/upload | jq -r .document_id)
curl -s -H "Authorization: Bearer $T" localhost:8000/pdf/$D/capabilities
curl -s -H "Authorization: Bearer $T" -H 'content-type: application/json' -X POST localhost:8000/pdf/edit \
  -d "{\"document_id\":\"$D\",\"expected_version\":1,\"operations\":[{\"op\":\"text_replace\",\"page\":1,\"find\":\"ACME-001\",\"replacement\":\"EDITED-1\"}]}"
curl -s -H "Authorization: Bearer $T" -H 'content-type: application/json' -X POST localhost:8000/pdf/pages/rotate -d "{\"document_id\":\"$D\",\"expected_version\":2,\"pages\":[1],\"angle\":90}"
curl -s -H "Authorization: Bearer $T" -H 'Range: bytes=0-1023' localhost:8000/documents/$D/download -o part.pdf
curl -s -H "Authorization: Bearer $T" localhost:8000/documents/$D/download -o out.pdf && pdftotext out.pdf - | head
```
## Integration test procedure
Upload fixture → GET capabilities → edit → confirm `version` incremented → render downloaded file in PDF.js → verify text changed. Report results back so endpoints can move to INTEGRATED.

---
# Phase 2 changes (branch feat/backend-phase2)
Scope note: THYNKPDF is free — no billing/paywall endpoints will be built.

## PR-1 contract changes (auth cookie, filename, capabilities schema, edit + page ops)
- **Refresh cookie**: `/auth/register`, `/auth/login`, `/auth/refresh` now also set `thynkpdf_rt` (httpOnly, SameSite=Strict (env `THYNKPDF_COOKIE_SAMESITE`), Path=/auth, Max-Age = refresh TTL; `Secure` when `THYNKPDF_COOKIE_SECURE=true`, required in prod/HTTPS). JSON body still contains `refresh_token` for non-browser clients — the web app should ignore it and rely on the cookie.
- `POST /auth/refresh` body is optional; reads the cookie when no body. Call with `fetch(url, {method:"POST", credentials:"include"})`.
- **Refresh rotation**: each refresh token is single-use. Reusing one → 401 `TOKEN_REVOKED`. Serialize refresh calls in the client (one in-flight refresh).
- `POST /auth/logout` (credentials: include) → 204, revokes the refresh token and clears the cookie. Idempotent.
- CORS: `allow_credentials=true` for `http://localhost:3000` (exact origin, no wildcard).
- `UploadOut` and `VersionResult` now include `filename` (sanitized basename).
- **`POST /documents/{id}/versions`** multipart: `file` (PDF) + form field `expected_version` → 201 `VersionResult` (`report.page_count`). Same validation as upload (magic bytes 415, malformed 422, size 413); stale → 409 `VERSION_CONFLICT`. Use this to save client-side modified bytes.
- `GET /pdf/{id}/capabilities` has a typed schema `CapabilitiesOut` (`PageOps`, `EditOps`, `PageCapability`, `Limitation`) and `GET /pdf/{id}/metadata` → `MetadataOut`. New fields: `edit_ops{text_replace,text_delete,text_move,text_insert}`, per-page same booleans, `page_ops.insert_blank|delete|duplicate`, `annotations`, `forms`.

### /pdf/edit operations
| op | required | behaviour / limits |
|---|---|---|
| text_replace | find, replacement | as before |
| text_delete | find, occurrence | removes glyphs from the run's string operand; later glyphs in the SAME run shift left; no paragraph reflow |
| text_move | find, dx, dy | moves the whole Tj/TJ run containing `find` (first match) by wrapping it in `Td` operators. dx/dy in text-space units (= PDF points for unscaled text). Scaled/rotated text matrix → `EDIT_NOT_SUPPORTED` (`TEXT_MATRIX_TRANSFORMED`) |
| text_insert | text, x, y, font?(std-14 Latin, default Helvetica), font_size?(12) | appends a real BT/Tj/ET text object; WinAnsi only (`EDIT_UNSUPPORTED_CHARACTERS`, `EDIT_UNSUPPORTED_FONT`) |
Delete/move/replace require the font to be listed in `pages[n].editable_fonts`. Coordinates are PDF user space, origin bottom-left, unrotated page.

### Page structure (each → new version, needs expected_version) — matches frontend R1.x
- `POST /pdf/pages/delete {document_id, expected_version, pages}` → 400 `INVALID_PAGE`, 400 `CANNOT_DELETE_ALL_PAGES`
- `POST /pdf/pages/duplicate {document_id, expected_version, pages:[int], position?: "after_each"|int(0..n)}` (annotations are NOT duplicated)
- `POST /pdf/pages/insert-blank {document_id, expected_version, after_page(0=start), count=1, width?, height?}` (size defaults to neighbour page)
- `POST /pdf/pages/insert-from {document_id, expected_version, source_document_id, source_pages?, after_page}` (source must be in the same org; it is not modified)

## PR-2: annotations (with comment threads) + forms — matches frontend §2/§3
### Annotations (real `/Annots` entries with generated `/AP` appearance streams)
- `GET /pdf/{id}/annotations?version=N&page=` → `{document_id, version, annotations: Annotation[]}`
  `Annotation = {id, page, type: highlight|underline|strikeout|ink|text|freetext|square|circle|line|arrow|stamp, rect, quad_points?, ink_list?: [[[x,y],...],...], color, opacity?, border_width?, contents?, author?, created_at, modified_at, stamp_name?, line?, in_reply_to?, state?: open|resolved, supported}`. Foreign subtypes (Link, Popup…) appear with `supported:false` and are read-only.
- `POST /pdf/annotations {document_id, expected_version, add?: Annotation[] (no id), update?: [{id, ...changed}], delete?: [id]}` → `VersionResult` with `report.ids` (new ids, add order). Atomic; order = delete → update → add.
- Threads: reply = `{type:"text", in_reply_to:<id>}` (written as `/IRT`); resolve = `update:[{id, state:"resolved"}]` (written as `/StateModel Review /State Completed` on the annotation — simplified vs. the spec's state-reply model). Deleting a parent deletes its replies.
- ids are `/NM` (`thynk-<hex>` for ours). Pre-existing annotations without `/NM` get positional ids `p{page}-i{index}` — refetch after each version.
- `stamp_name` ∈ Approved, NotApproved, Draft, Final, Confidential, ForComment, Expired, Experimental, AsIs, Sold, Departmental, ForPublicRelease, NotForPublicRelease, TopSecret. `freetext` uses `contents` (WinAnsi) and optional `font_size`.
- Errors: `ANNOTATION_NOT_FOUND` (404), `INVALID_REQUEST` (400, bad rect/quad/ink/stamp), `EDIT_NOT_SUPPORTED`. Moving an annotation across pages = delete + add.
### Forms (PDF JavaScript is never executed; `has_actions`/`calculated` are only reported)
- `GET /pdf/{id}/forms?version=N` → `{document_id, version, fields:[{name, type: text|checkbox|radio|dropdown|listbox|signature, multiline, page, rect, value, options?, required, read_only, max_length?, has_actions, calculated}]}`
- `POST /pdf/forms/fields {document_id, expected_version, add:[{name, type, page, rect | rects (radio, one per option), options?, required?, default?, multiline?, read_only?, max_length?}], delete?:[name]}` → `VersionResult` (`FORM_FIELD_EXISTS` 409, `FORM_FIELD_NOT_FOUND`).
- `POST /pdf/forms/fill {document_id, expected_version, values:{name: string|boolean|string[]}, flatten?}` → `VersionResult` (`report.missing_required`). Also accepts `csv` instead of `values`. Invalid → 422 `VALIDATION_ERROR` with `details.fields`.
- `POST /pdf/forms/flatten {document_id, expected_version, confirm:true}`; `GET /pdf/{id}/forms/export?format=json|csv`.
