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

## PR-3: signatures, signature requests, audit — matches frontend §4
Visual signatures are NOT cryptographic/PAdES. No claim of legal enforceability; pending legal review.
### R4.1 Signature assets (per user, org-scoped)
- `POST /signatures/assets` multipart `file` (PNG ≤ 1 MB, ≤ 4 MP) or JSON `{kind:"typed", text, font?: Times-Italic|Helvetica-Oblique|Courier-Oblique|Times-BoldItalic|Helvetica}` → 201 `{asset_id, kind, width, height, text?, font?, created_at}`. **SVG is rejected** (415 `SVG_NOT_SUPPORTED`, scripting/external-ref risk) — rasterize to PNG client-side. Errors: `FILE_TOO_LARGE` 413, `INVALID_FILE_TYPE` 415.
- `GET /signatures/assets`, `DELETE /signatures/assets/{id}` (204), `GET /signatures/assets/{id}/image` (PNG; typed = low-fi preview, the PDF uses the real font).
### R4.2 Placement (versioned)
- `POST /pdf/signatures/place {document_id, expected_version, placements:[{asset_id, page, rect, field_name?}]}` → `VersionResult` (`report.visual_only:true`). Image drawn as page content (keeps aspect ratio, centred in rect); typed drawn as text. Writes audit `sign`.
### R4.3 Request flow
- `POST /signature-requests {document_id, version (must be current), signers:[{email,name,order?}], message?, title?, fields:[{signer_index, page, rect, type: signature|initials|date|text}]}` → 201 `{request_id, status:"pending", signer_links:[{signer_index,email,token,path:"/sign/<token>"}]}`. Every signer needs ≥1 signature field. If any `order` is given, signing is sequential by order.
- **Email sending is BLOCKED (no provider configured):** `signer_links` are returned ONCE to the creator; the UI must show/copy them. `notification_queued`/`reminder_queued` events record `delivered:false`.
- `GET /signature-requests/{id}` → `{request_id, document_id, version, status: pending|completed|declined|cancelled|needs_attention, message, title, created_at, final_version_id, signers[{signer_index,email,name,order,status,consent_at,signed_at}], fields[{field_id,signer_index,page,rect,type,completed}], chain_valid, head_hash}`
- `GET /signature-requests?document_id=`, `GET /signature-requests/{id}/events` (sha256 hash chain), `POST /signature-requests/{id}/cancel`, `POST /signature-requests/{id}/remind` → `{queued:[emails], delivered:false, note}`.
- Signer link (no account): `GET /sign/{token}` → `{request_id, title, message, signer_index, signer_name, signer_email, status, can_sign, blocked_reason, consent_text, consent_text_version:"v1", document_sha256, page_count, document_path, fields[]}`; `GET /sign/{token}/document` (PDF); `POST /sign/{token}/complete {consent:true, consent_text_version:"v1", placements:[{field_id, text?, font?, image_base64?}]}` (date fields auto-fill with today UTC if omitted; all other fields of this signer required) → request; `POST /sign/{token}/decline {reason}`.
- When the last signer completes, the backend finalizes: stamps all fields into the source version, appends an "Electronic Signature Certificate" page (signers, consent, IPs, event hashes, chain head), applies a server pyHanko signature (dev cert = untrusted), and saves it as a NEW version (`final_version_id`). If the document changed meanwhile, status becomes `needs_attention` (no silent overwrite).
- Errors: `SIGNER_TOKEN_INVALID` (404), `CONSENT_REQUIRED`, `SIGNING_NOT_ALLOWED` (`details.reason`), `SIGNING_INVALID_STATE`, `SIGNING_REQUEST_NOT_FOUND`, `ASSET_NOT_FOUND`.
### Cryptographic (TYPE B)
- `GET /pdf/signatures/certificate`, `POST /pdf/signatures/sign {document_id, expected_version, field_name?, reason?, location?, page?, rect?}`, `GET /pdf/{id}/signatures?version=` → `{signatures:[{field,intact,crypto_valid,trusted,coverage,modification_level,signing_time,signer_subject,modified_after_signing}]}`. Dev cert CN contains "UNTRUSTED" and is always `trusted:false`; keys are never returned. Signed docs refuse in-place edits (409 `DOCUMENT_SIGNED`).
### R4.4 Audit
- `GET /documents/{id}/audit?limit=` → `[{at, actor_email, action, version, ip?, user_agent?, details}]`; actions include upload, view (each download / signer view), sign, request_sent, request_cancelled, declined, completed, and every versioned op (rotate, annotations, form_fill, signature_place, esign_complete…).
- `GET /audit?action=&target=&user_id=&since=&until=` (admin+, org-wide).

## PR-4: document management — matches frontend §5
- **BREAKING:** `GET /documents?q=&folder_id=(id|root)&tag=&starred=&trashed=&sort=updated_at|name|created_at&order=asc|desc&limit(≤200)=&cursor=` → `{items: DocumentOut[], next_cursor}` (opaque cursor). `DocumentOut` now has `folder_id, tags, starred (per caller), trashed_at, updated_at, size, page_count, visibility, created_by`.
- `PATCH /documents/{id} {filename?, folder_id? ("root" to unfile), tags? (replaces set; a-z0-9_-), starred?, visibility?: org|restricted}` → DocumentOut. `starred` is personal and allowed for viewers; other fields need edit rights; `visibility` needs creator/admin.
- `DELETE /documents/{id}` → trash (DocumentOut with `trashed_at`); `POST /documents/{id}/restore`; `DELETE /documents/{id}?permanent=true` → 204, only from trash (`NOT_IN_TRASH`), blocked by pending signature requests (`SIGNING_IN_PROGRESS`); irreversibly deletes all stored version bytes (metadata + audit kept). Show a confirmation dialog.
- Folders: `GET/POST /folders {name, parent_id?}`, `PATCH /folders/{id} {name?, parent_id? ("root")}`, `DELETE /folders/{id}` (`FOLDER_NOT_EMPTY`, `FOLDER_EXISTS`, `FOLDER_CYCLE`). `GET /tags`.
- Sharing: `POST /documents/{id}/shares {email|null, role: viewer|editor, expires_at?}` → `{share_id, kind:user|link, email, role, expires_at, created_at, url?}`. email must be a member of the same org (`USER_NOT_IN_ORG`; cross-org sharing not supported) — grants matter for `visibility:"restricted"` docs. `email:null` → public **view-only** link, `url:"/shared/<token>"` returned once (`LINK_EDITOR_NOT_SUPPORTED` for editor). `GET /documents/{id}/shares`, `DELETE /shares/{id}`.
- Public link (no auth): `GET /shared/{token}` → `{filename, version, size, page_count, expires_at, file_path}`; `GET /shared/{token}/file` (PDF, Range supported; audited as view by "public-link").
- `POST /documents/{id}/versions/{version_id}/restore {expected_version?}` → VersionResult (new version with the old bytes; history kept). The earlier `/documents/{id}/rollback` was replaced by this.

## PR-5: AI panel — matches frontend §6
- `POST /ai/ask {document_id, version?, question, page_range?:[start,end]}` and `POST /ai/summarize {document_id, version?, length: short|long, page_range?}` → `{answer, citations:[{page, quote}], model, uncertain, retrieval:"bm25-lexical", external_processing, document_id, version}`. No SSE streaming yet (single JSON response).
- Default provider is `thynkpdf-extractive-stub-v1`: deterministic, extractive (quotes document sentences), no network, free. It is NOT an LLM — show answers as "excerpts". `uncertain:true` when the answer is not supported by the document.
- Rate limit (free tier): per org, `THYNKPDF_AI_RATE_PER_MIN` (default 20) → 429 `RATE_LIMITED` with `details.retry_after` (seconds) and `details.limit_per_minute`.
- External LLM processing requires explicit opt-in: `PUT /ai/settings {external_enabled:true, provider:"openai_compatible", acknowledge_external_processing:true}` (admin+; else 422 `AI_OPT_IN_REQUIRED`), plus server env `THYNKPDF_AI_EXTERNAL_BASE_URL/_API_KEY/_MODEL` (else 503 `AI_PROVIDER_NOT_CONFIGURED`). `GET /ai/settings` → `{external_enabled, provider, external_configured, rate_limit_per_minute}`.
- Document text is treated as untrusted data (fenced in the prompt; instructions inside documents are not followed). Scanned PDFs → 422 `NO_TEXT_LAYER` (OCR is BLOCKED on this server). Every call is audited (`ai.ask` / `ai.summarize`).

## Frontend requests R4.5 / R5.6 / R0.3
- **R4.5** `/pdf/signatures/place` and signer completion now counter-rotate stamps by the page's effective `/Rotate` (inherited, 90/180/270), so they appear upright as displayed. `rect` stays in **unrotated PDF user space** (same as before). Images keep their aspect ratio within the rect's displayed orientation. Typed text is real text drawn with a rotated `Tm`. The browser workaround can be removed.
- **R5.6** `CreatedReqOut.signer_links` is now `SignerLink[]` = `{signer_index, email, token, path}` (`path` = `/sign/{token}`).
- **R0.3** In `openapi.json`, no schema marks a defaulted field as `required`; a test enforces this. `FieldSpec.font_size` and `EditOp.font` are optional.
- Text-edit report field stays `count`.

## XFA forms (branch feat/xfa) — PDF scripts (FormCalc/JavaScript) are NEVER executed
- `GET /pdf/{id}/forms` now also returns `xfa: {present, kind: none|hybrid|dynamic, form: stream|array|null, packets:[names], has_scripts, script_count, needs_rendering, acroform_widgets, xml_safe}`. `hybrid` = XFA + AcroForm widgets; `dynamic` = XFA with no widgets or `/NeedsRendering true`. `xml_safe:false` means a packet has a DTD/entities and every XFA read/write will return 422 `XFA_UNSAFE_XML`.
- `GET /pdf/{id}/forms/xfa?version=N` → `{document_id, version, xfa, fields:[{name: "form1.full_name", value: string, acroform_field: "form1[0].full_name[0]"|null}]}` (flat datasets; repeated siblings get `[n]` for n≥1).
- `GET /pdf/{id}/forms/xfa/schema?version=N` → `{document_id, version, xfa, fields:[{name (data path = fill key, null if unbound), som, type: text|numeric|date|checkbox|choice|radio|signature|button|image|barcode|password, caption, options, option_captions, multi_select, on_value, value, required, read_only, multiline, max_chars, layout:{x,y,w,h,units:"pt",origin}}], warnings:[...], scripts_ignored}`. Use this to render a fill UI for dynamic XFA. `choice.options` are the saved values, `option_captions` the labels; radio = exclGroup.
- `POST /pdf/forms/xfa/fill {document_id, expected_version, values:{key: string|bool}}` → `VersionResult`, `report:{filled, kind, acroform_updated, datasets_updated, missing_required?}`. Keys may be data paths or AcroForm names. Hybrid writes both; dynamic writes datasets only (creates missing nodes). Booleans → "1"/"0".
- `GET /pdf/{id}/forms/xfa/data.xml` → `application/xml` `<xfa:datasets>` export. `POST /pdf/forms/xfa/data {document_id, expected_version, xml}` → `VersionResult` (`report:{imported, kind, acroform_updated}`); accepts `<xfa:datasets>`, `<xfa:data>` or a bare record element; hybrid also updates matching AcroForm fields.
- `POST /pdf/forms/xfa/convert {document_id, expected_version}` → `VersionResult`. Hybrid: `report.mode="stripped_xfa"` (removes /XFA + /NeedsRendering, keeps widgets). Dynamic: `report.mode="rendered_from_template"`, `{pages, fields, field_map:{acroName:{xfa_name, som, type}}, warnings, scripts_ignored}` — new Letter pages with captions + widgets, pre-filled from datasets; AcroForm names are the data path with non `[A-Za-z0-9_-]` → `_` (e.g. `form1_address_city`). 422 `xfa_dynamic_unsupported` (details.unsupported) only when there is no template/root subform or no convertible field.
- `POST /pdf/forms/fill` on hybrid also mirrors values into datasets (`report.xfa_datasets_synced`). `POST /pdf/forms/flatten` strips XFA on hybrid and converts-then-flattens dynamic.
- Errors: `XFA_NOT_PRESENT` 422, `XFA_MALFORMED` 422, `XFA_UNSAFE_XML` 422, `XFA_TOO_LARGE` 413 (5 MB/packet, 20 MB total, 20k nodes, depth 64, flate-bomb capped), `xfa_dynamic_unsupported` 422, `VERSION_CONFLICT` 409.
- Not supported: script execution/calculations/validation scripts; repeating subform instances (`occur`) beyond the template once; `lr-tb`/`rl-tb`/`table`/`row` layouts (rendered top-down); pageSet/master pages, page backgrounds and draw graphics/images; button/image/barcode fields in conversion; rich-text (`exData`) values become plain text; dropdown labels in converted PDFs show save values; locale/picture-clause formatting; XFA digital signatures; original page content of a dynamic doc is replaced by the generated layout.

### XFA update (PR #24, real-form pass: 12 USCIS/OPM hybrid forms + Grants.gov SF-424 dynamic)
- **Version check first:** every XFA write (and `/pdf/forms/fill`, `/pdf/forms/flatten`) returns 409 `VERSION_CONFLICT` for a stale `expected_version` before looking at content (so a stale fill on a converted doc is 409, not 422 `XFA_NOT_PRESENT`).
- **`som` is now fully indexed** (`form1[0].#subform[2].#area[0].ANumber[0]`, literal dots escaped `Section9\.1[0]`). Unnamed subforms/areas follow Designer's rules, so on hybrid forms `som` == the AcroForm field name; `acroform_field` gives it explicitly. Data paths (`name`, the fill key) index repeated siblings `X[1]` and escape dots too.
- **Schema field additions:** `acroform_field`, `section` (SOM of enclosing subform), `section_name`, `section_caption`, `occur {min,max(-1=unbounded),initial}` + `instance` (nearest repeatable subform), `tooltip`. `max_chars` also comes from AcroForm `MaxLen` (comb fields); `read_only` also from the AcroForm flag.
- **Repeating subforms:** emitted max(initial, min, instances present in data) times (cap 50), as `row[0]`, `row[1]`…; data path `app.row[1].item`.
- **Import:** `POST /pdf/forms/xfa/data {…, mode: "merge"|"replace"}` — default `merge` only changes the leaves present in the XML; `replace` swaps the whole datasets packet. `report: {imported, mode, kind, acroform_updated, missing_required, usage_rights_removed, form_state_packet_removed}`.
- **Fill report:** `{filled, kind, acroform_updated, datasets_updated, not_bound, missing_required, usage_rights_removed, form_state_packet_removed}`. Radio/checkbox values are translated both ways (XFA item value ↔ widget on-state); keys may be data path, SOM or AcroForm name.
- **Rights-enabled / encrypted PDFs:** Reader Extensions (`/Perms /UR3`) are removed whenever we write (they'd be invalid and Reader would show an error); the stale `form` state packet is dropped. Files encrypted with an empty user password (all USCIS forms) open fine; output is saved **unencrypted**. Files needing a user password → 422 `PDF_ENCRYPTED` (unchanged).
- **Rich-text data** (XHTML `<body>` values) is read as plain text; writing replaces it with plain text.
- **Dynamic convert:** page size + content area from the first `pageArea`/`contentArea`, master-page draw text repeated per page, static draw text word-wrapped, `lr-tb`/`row` flow left-to-right, dropdown `/Opt` keeps save values with display labels, light field boxes drawn on the page.
- **`GET /pdf/{id}/capabilities`** now has `xfa: {present, kind, read, schema, fill, xml_import_export, convert, flatten, has_scripts, error}`.
- Typed OpenAPI schemas: `XfaInfo, XfaDataOut, XfaSchemaOut, XfaSchemaField, XfaOccur, XfaFillReport, XfaImportReport, XfaConvertReport, XfaCapabilities`.
