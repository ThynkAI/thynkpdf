# THYNKPDF frontend → backend endpoint requests
Owner: frontend (THYNKPDF1). Checked against `docs/openapi.json` (22 paths) on 2026-10-31.
Conventions assumed (match existing API): JSON bodies, `Authorization: Bearer`, error envelope `{"error":{code,message,details}}`,
modifying ops on an existing doc take `expected_version` and return `VersionResult` (409 `VERSION_CONFLICT` when stale), page numbers 1-based.
Features that depend on these are shown disabled in the UI with a reason; nothing is faked client-side.

## 0. Contract hygiene (non-blocking)
- R0.1 Add response schemas to openapi for `GET /pdf/{id}/capabilities` and `GET /pdf/{id}/metadata` (frontend currently hand-types them).
- R0.2 Refresh token in an httpOnly `SameSite=Strict; Secure` cookie: `POST /auth/login` + `POST /auth/refresh` set cookie `thynkpdf_rt`; `/auth/refresh` accepts the cookie when the body is empty; `POST /auth/logout` clears it. Frontend then drops sessionStorage tokens.
- R0.3 `UploadOut` + `VersionResult`: include `filename`.

## 1. Page organizer (Phase C) — BLOCKED parts: delete, duplicate, insert blank, insert from PDF
- R1.1 `POST /pdf/pages/delete` `{document_id, expected_version, pages:[int]}` → `VersionResult`. 400 `INVALID_PAGE`, 400 `CANNOT_DELETE_ALL_PAGES`.
- R1.2 `POST /pdf/pages/duplicate` `{document_id, expected_version, pages:[int], position?: "after_each"|int}` → `VersionResult`.
- R1.3 `POST /pdf/pages/insert-blank` `{document_id, expected_version, after_page:int (0 = start), count:int=1, width?:number, height?:number}` (default size = neighbor page) → `VersionResult`.
- R1.4 `POST /pdf/pages/insert-from` `{document_id, expected_version, source_document_id, source_pages?:[int], after_page:int}` → `VersionResult` (source may be an uploaded doc).
- (Alternative: one generic `POST /pdf/pages/apply {document_id, expected_version, ops:[...]}` doing all of the above atomically.)

## 2. Annotations (Phase D) — BLOCKED
Need annotations written as real PDF annotations into a new version.
- R2.1 `GET /pdf/{id}/annotations?version=N` → `{annotations: Annotation[]}` where
  `Annotation = {id, page, type: "highlight"|"underline"|"strikeout"|"ink"|"text"(sticky note)|"freetext"|"square"|"circle"|"line"|"arrow"|"stamp", rect:[x1,y1,x2,y2] (PDF user space), quad_points?:number[], ink_list?:number[][][], color:[r,g,b], opacity?:number, border_width?:number, contents?:string, author?:string, created_at, modified_at, stamp_name?:string, line?:[x1,y1,x2,y2], in_reply_to?:id, state?:"open"|"resolved"}`
- R2.2 `POST /pdf/annotations` `{document_id, expected_version, add?:Annotation[] (no id), update?:Annotation[], delete?:[id]}` → `VersionResult` + `report.ids` (new ids in add order).
- R2.3 Comment threads: replies are `type:"text"` with `in_reply_to` (PDF `/IRT`), resolve = `state`. Same endpoint as R2.2.

## 3. Forms (Phase E) — BLOCKED
- R3.1 `GET /pdf/{id}/forms?version=N` → `{fields:[{name, type:"text"|"checkbox"|"radio"|"dropdown"|"listbox"|"signature", page, rect, value, options?, required, read_only, max_length?}]}`
- R3.2 `POST /pdf/forms/fill` `{document_id, expected_version, values:{[name]:string|boolean|string[]}, flatten?:bool}` → `VersionResult`.
- R3.3 `POST /pdf/forms/fields` `{document_id, expected_version, add:[{name,type,page,rect,options?,required?,default?}], delete?:[name]}` → `VersionResult`.

## 4. Signatures (Phase E) — BLOCKED
Visual e-signatures (image stamped into page), explicitly NOT cryptographic/PAdES. UI labels them as such.
- R4.1 `POST /signatures/assets` multipart `file` (PNG/SVG ≤1MB) or JSON `{kind:"typed", text, font}` → `{asset_id, kind, width, height}`; `GET /signatures/assets`, `DELETE /signatures/assets/{id}`, `GET /signatures/assets/{id}/image`.
- R4.2 `POST /pdf/signatures/place` `{document_id, expected_version, placements:[{asset_id, page, rect, field_name?}]}` → `VersionResult` (also records an audit event).
- R4.3 Request flow: `POST /signature-requests {document_id, version, signers:[{email, name, order?}], message?, fields:[{signer_index, page, rect, type:"signature"|"initials"|"date"|"text"}]}` → `{request_id, status}`; `GET /signature-requests/{id}`; `GET /signature-requests?document_id=`; `POST /signature-requests/{id}/cancel`; `POST /signature-requests/{id}/remind`; signer link flow: `GET /sign/{token}` + `POST /sign/{token}/complete {placements}`. Email sending is the backend's responsibility.
- R4.4 Audit: `GET /documents/{id}/audit` → `[{at, actor_email, action:"upload"|"view"|"sign"|"request_sent"|"declined"|..., version, ip?, user_agent?, details}]`.

## 5. Document management dashboard (Phase F) — PARTIAL (list/upload/versions/open work); BLOCKED: folders, tags, star, trash, share, rename, server search
- R5.1 `GET /documents?q=&folder_id=&tag=&starred=&trashed=&sort=updated_at|name&order=&limit=&cursor=` → `{items: DocumentOut+{folder_id, tags, starred, trashed_at, updated_at, size, page_count}, next_cursor}`.
- R5.2 `PATCH /documents/{id}` `{filename?, folder_id?, tags?, starred?}` → DocumentOut.
- R5.3 `DELETE /documents/{id}` (move to trash), `POST /documents/{id}/restore`, `DELETE /documents/{id}?permanent=true`.
- R5.4 Folders: `GET/POST /folders {name, parent_id?}`, `PATCH /folders/{id}`, `DELETE /folders/{id}`.
- R5.5 Sharing: `POST /documents/{id}/shares {email|null (link), role:"viewer"|"editor", expires_at?}` → `{share_id, url?}`; `GET /documents/{id}/shares`; `DELETE /shares/{id}`.
- R5.6 `POST /documents/{id}/versions/{version_id}/restore` → `VersionResult` (make an old version current).

## 6. AI panel (Phase G) — BLOCKED (no /ai endpoints)
- R6.1 `POST /ai/ask {document_id, version, question, page_range?}` → `{answer, citations:[{page, quote}], model}` (or SSE stream `text/event-stream`).
- R6.2 `POST /ai/summarize {document_id, version, length:"short"|"long"}` → same shape.
- Must be free-tier safe (THYNKPDF is free): document rate limits in the response (`429 RATE_LIMITED` with `details.retry_after`).

## Status check 2026-10-31 ~2:05 PM EDT
Open (unmerged) backend PRs add many of the above: #4 `feat/backend-phase2` (cookie refresh, typed capabilities, page delete/duplicate/insert-blank),
#6 `feat/backend-annotations-forms` (annotations CRUD, forms create/fill/flatten/export), #8 `feat/backend-signing-audit` (e-sign workflow, PAdES sign, audit).
None is on `main` and the live dev API (:8000) still serves the 22-path main contract, so the frontend has not wired them yet.
Still missing from all branches: version upload from client bytes (`POST /documents/{id}/versions` multipart + expected_version), folders/tags/star/trash/share, `/ai`.
