# THYNKPDF frontend → backend endpoint requests
Owner: frontend (THYNKPDF1). Checked against `docs/openapi.json` (22 paths) on 2026-10-31.
Conventions assumed (match existing API): JSON bodies, `Authorization: Bearer`, error envelope `{"error":{code,message,details}}`,
modifying ops on an existing doc take `expected_version` and return `VersionResult` (409 `VERSION_CONFLICT` when stale), page numbers 1-based.
Features that depend on these are shown disabled in the UI with a reason; nothing is faked client-side.

## 0. Contract hygiene (non-blocking)
- R0.1 Add response schemas to openapi for `GET /pdf/{id}/capabilities` and `GET /pdf/{id}/metadata` (frontend currently hand-types them).
- R0.2 Refresh token in an httpOnly `SameSite=Strict; Secure` cookie: `POST /auth/login` + `POST /auth/refresh` set cookie `thynkpdf_rt`; `/auth/refresh` accepts the cookie when the body is empty; `POST /auth/logout` clears it. Frontend then drops sessionStorage tokens.
- R0.3 `UploadOut` + `VersionResult`: include `filename`.

## 1. Page organizer (Phase C) — RESOLVED (wired in feat/web-backend-phase2)
- R1.1 `POST /pdf/pages/delete` `{document_id, expected_version, pages:[int]}` → `VersionResult`. 400 `INVALID_PAGE`, 400 `CANNOT_DELETE_ALL_PAGES`.
- R1.2 `POST /pdf/pages/duplicate` `{document_id, expected_version, pages:[int], position?: "after_each"|int}` → `VersionResult`.
- R1.3 `POST /pdf/pages/insert-blank` `{document_id, expected_version, after_page:int (0 = start), count:int=1, width?:number, height?:number}` (default size = neighbor page) → `VersionResult`.
- R1.4 `POST /pdf/pages/insert-from` `{document_id, expected_version, source_document_id, source_pages?:[int], after_page:int}` → `VersionResult` (source may be an uploaded doc).
- (Alternative: one generic `POST /pdf/pages/apply {document_id, expected_version, ops:[...]}` doing all of the above atomically.)

## 2. Annotations (Phase D) — RESOLVED (endpoints on main; see status below)
Need annotations written as real PDF annotations into a new version.
- R2.1 `GET /pdf/{id}/annotations?version=N` → `{annotations: Annotation[]}` where
  `Annotation = {id, page, type: "highlight"|"underline"|"strikeout"|"ink"|"text"(sticky note)|"freetext"|"square"|"circle"|"line"|"arrow"|"stamp", rect:[x1,y1,x2,y2] (PDF user space), quad_points?:number[], ink_list?:number[][][], color:[r,g,b], opacity?:number, border_width?:number, contents?:string, author?:string, created_at, modified_at, stamp_name?:string, line?:[x1,y1,x2,y2], in_reply_to?:id, state?:"open"|"resolved"}`
- R2.2 `POST /pdf/annotations` `{document_id, expected_version, add?:Annotation[] (no id), update?:Annotation[], delete?:[id]}` → `VersionResult` + `report.ids` (new ids in add order).
- R2.3 Comment threads: replies are `type:"text"` with `in_reply_to` (PDF `/IRT`), resolve = `state`. Same endpoint as R2.2.

## 3. Forms (Phase E) — RESOLVED (wired)
- R3.1 `GET /pdf/{id}/forms?version=N` → `{fields:[{name, type:"text"|"checkbox"|"radio"|"dropdown"|"listbox"|"signature", page, rect, value, options?, required, read_only, max_length?}]}`
- R3.2 `POST /pdf/forms/fill` `{document_id, expected_version, values:{[name]:string|boolean|string[]}, flatten?:bool}` → `VersionResult`.
- R3.3 `POST /pdf/forms/fields` `{document_id, expected_version, add:[{name,type,page,rect,options?,required?,default?}], delete?:[name]}` → `VersionResult`.

## 4. Signatures (Phase E) — RESOLVED except R4.5 (below)
Visual e-signatures (image stamped into page), explicitly NOT cryptographic/PAdES. UI labels them as such.
- R4.1 `POST /signatures/assets` multipart `file` (PNG/SVG ≤1MB) or JSON `{kind:"typed", text, font}` → `{asset_id, kind, width, height}`; `GET /signatures/assets`, `DELETE /signatures/assets/{id}`, `GET /signatures/assets/{id}/image`.
- R4.2 `POST /pdf/signatures/place` `{document_id, expected_version, placements:[{asset_id, page, rect, field_name?}]}` → `VersionResult` (also records an audit event).
- R4.3 Request flow: `POST /signature-requests {document_id, version, signers:[{email, name, order?}], message?, fields:[{signer_index, page, rect, type:"signature"|"initials"|"date"|"text"}]}` → `{request_id, status}`; `GET /signature-requests/{id}`; `GET /signature-requests?document_id=`; `POST /signature-requests/{id}/cancel`; `POST /signature-requests/{id}/remind`; signer link flow: `GET /sign/{token}` + `POST /sign/{token}/complete {placements}`. Email sending is the backend's responsibility.
- R4.4 Audit: `GET /documents/{id}/audit` → `[{at, actor_email, action:"upload"|"view"|"sign"|"request_sent"|"declined"|..., version, ip?, user_agent?, details}]`.

## 5. Document management dashboard (Phase F) — RESOLVED (wired; rename UI not built yet)
- R5.1 `GET /documents?q=&folder_id=&tag=&starred=&trashed=&sort=updated_at|name&order=&limit=&cursor=` → `{items: DocumentOut+{folder_id, tags, starred, trashed_at, updated_at, size, page_count}, next_cursor}`.
- R5.2 `PATCH /documents/{id}` `{filename?, folder_id?, tags?, starred?}` → DocumentOut.
- R5.3 `DELETE /documents/{id}` (move to trash), `POST /documents/{id}/restore`, `DELETE /documents/{id}?permanent=true`.
- R5.4 Folders: `GET/POST /folders {name, parent_id?}`, `PATCH /folders/{id}`, `DELETE /folders/{id}`.
- R5.5 Sharing: `POST /documents/{id}/shares {email|null (link), role:"viewer"|"editor", expires_at?}` → `{share_id, url?}`; `GET /documents/{id}/shares`; `DELETE /shares/{id}`.
- R5.6 `POST /documents/{id}/versions/{version_id}/restore` → `VersionResult` (make an old version current).

## 6. AI panel (Phase G) — RESOLVED (stub provider; wired as excerpt mode)
- R6.1 `POST /ai/ask {document_id, version, question, page_range?}` → `{answer, citations:[{page, quote}], model}` (or SSE stream `text/event-stream`).
- R6.2 `POST /ai/summarize {document_id, version, length:"short"|"long"}` → same shape.
- Must be free-tier safe (THYNKPDF is free): document rate limits in the response (`429 RATE_LIMITED` with `details.retry_after`).

## Status check 2026-10-31 ~2:05 PM EDT
Open (unmerged) backend PRs add many of the above: #4 `feat/backend-phase2` (cookie refresh, typed capabilities, page delete/duplicate/insert-blank),
#6 `feat/backend-annotations-forms` (annotations CRUD, forms create/fill/flatten/export), #8 `feat/backend-signing-audit` (e-sign workflow, PAdES sign, audit).
None is on `main` and the live dev API (:8000) still serves the 22-path main contract, so the frontend has not wired them yet.
Still missing from all branches: version upload from client bytes (`POST /documents/{id}/versions` multipart + expected_version), folders/tags/star/trash/share, `/ai`.

## Status 2026-10-31 (afternoon, EDT) — branch feat/web-backend-phase2 against main 9d355e5e (64 paths)
Wired: cookie refresh (single in-flight, credentials:"include", no refresh token in JS/sessionStorage), logout; GET /documents {items,next_cursor}
with server search/sort/paging; star/tags/folders/move/trash/restore/permanent delete (confirm)/shares (+ one-time public view-only link);
version restore; page delete/duplicate/insert-blank/insert-from; POST /documents/{id}/versions for client-written annotations and forms on
local-origin edits; server forms API (list/add/fill/flatten); signature assets (PNG only — drawn/typed/JPEG/SVG rasterized client-side) +
/pdf/signatures/place; signature requests (one-time signer links with copy buttons, status, events, cancel); public signer page /sign/[token]
(consent, typed or drawn signature, decline); public share page /shared/[token] (view-only); audit trail + signature verification;
DOCUMENT_SIGNED shown distinctly from VERSION_CONFLICT; AI ask/summarize panel labelled "Excerpt mode (stub)" with page links and
RATE_LIMITED countdown.

Not using server endpoints yet (truthful note): the annotation tools still write real PDF annotations in the browser (pdf-lib) and the
result is saved with POST /documents/{id}/versions (expected_version from the version the edits started on). Migrating the tools to
POST /pdf/annotations is follow-up work, not a backend blocker.

New requests:
- **R4.5** `/pdf/signatures/place` and signer completion stamp images axis-aligned in unrotated page space, so on a /Rotate 90/180/270 page the
  signature appears sideways. Please counter-rotate the stamp by the page rotation (frontend workaround: rotated pages are stamped upright in the
  browser and saved via /documents/{id}/versions).
- **R5.6** `signer_links[]` items are untyped in openapi (`{[key]: unknown}`); please add a `SignerLink` schema `{signer_index,email,token,path}`.
- **R0.3** Several input schemas mark defaulted fields as required in openapi (e.g. `FieldSpec.font_size`, `EditOp.font`), which forces casts
  in the generated client. Please mark them optional (`required` only for fields without defaults).

## Status 2026-10-31 (late afternoon, EDT) — branch feat/web-phase3
- The annotation tools now call `POST /pdf/annotations` / `GET /pdf/{id}/annotations` for server documents. Each change is one versioned
  write, replies use `in_reply_to`, and resolve/reopen use `state`. Rename for documents (`PATCH /documents/{id} {filename}`) and folders
  (`PATCH /folders/{id} {name}`) is wired. `?tool=compress` uses the existing `POST /pdf/compress`, so no request is needed.
- **R2.4** The server writes FreeText/stamp text in WinAnsi/Helvetica only. Please embed a Unicode font (for example Noto Sans, OFL) so
  non-Latin-1 comments can be written by the server. Today the frontend writes those in the browser with Noto Sans and saves them through
  `POST /documents/{id}/versions`.
- **R2.5** Server FreeText/stamp appearances aren't counter-rotated on /Rotate pages, and there's no callout (`FreeTextCallout`) type.
  The frontend writes those in the browser (rotated `/Matrix`) as a fallback.
- R4.5 (rotated signature stamps) and R5.6 (typed SignerLink) are addressed by open backend PR #16. Once that PR is merged, remove the
  client-side rotated-signature path in SignPanel and the `signer_links` casts.
- **WebKit locally:** `npx playwright install-deps webkit` and plain apt both fail on this box. The Debian mirror (deb.debian.org via
  198.18.0.1) returns 500 for trixie, trixie-updates and trixie-security, so the WebKit system libraries can't be installed. WebKit runs in
  CI instead: workflow at `packages/frontend-tests/ci/web-e2e.yml`, to be copied to `.github/workflows/` by someone whose token has the `workflow` scope (push was rejected without it).

## Update after #15/#16 merged into main
- R4.5 (rotated-page signatures): frontend workaround removed; server documents always use `POST /pdf/signatures/place`. Covered by e2e "signature on a rotated page".
- R5.6 (typed SignerLink): casts removed; signer links are built from `token`.
- R0.3 (optional defaulted fields): the client is now generated with `--default-non-nullable false`, so the `FieldSpec`/`EditOp` loosening is gone.
- Static export / apps/desktop: public pages are `/sign/?token=` and `/shared/?token=`. The sidecar serves `/sign/{token}` and `/shared/{token}` as API routes, so those can't be pages. The launcher ids `merge` and `annotate` are accepted as aliases. **Backend request R6.1:** have `CreatedReqOut.signer_links[].path` and `ShareOut.url` return the query form, or return only the token, so clients don't need to rebuild the URLs.

## XFA forms (branch feat/xfa-support, 2026-10-31) — requests for THYNKPDF2 (backend feat/xfa)
Frontend behaviour now: PDF.js opens every PDF with `enableXfa: true`. Dynamic XFA (`isPureXfa`) is rendered client-side by the XFA layer and filled via PDF.js `annotationStorage`; "Save" uses `saveDocument()` (values go into the XFA datasets) and, for server documents, uploads the bytes as a new version (`POST` upload-version, existing contract). Hybrid XFA+AcroForm shows the AcroForm; filling via pdf-lib explicitly deletes `/XFA` on that save and tells the user. Stamp/annotation/add-field writes now preserve `/XFA` (pdf-lib's default `save()` was silently deleting it). No existing contract changed.
- **R7.1 convert endpoint.** Client stub: `HttpEditorApi.convertXfaToAcroForm(ref)` → `POST /pdf/forms/xfa/convert` with `{document_id, version_id|version}` returning `VersionResult`. The path is a placeholder — please confirm the real one and we'll update the single call site. The UI hides the action after a 404/405.
- **R7.2 422 `xfa_dynamic_unsupported`.** Handled: shown as "dynamic XFA form with no standard fields to convert; fill it here and save a copy". Please return `code` exactly `xfa_dynamic_unsupported` (case-insensitive match).
- **R7.3 detection.** Please expose `xfa: {present, kind: none|hybrid|dynamic, packets, has_scripts}` on `/metadata` (or `/pdf/forms`). The frontend currently detects client-side (PDF.js `isPureXfa` + `IsXFAPresent`) and will prefer the server value when present.
- **R7.4 metadata page sizes.** For dynamic XFA, `/metadata.pages` describes the 1-page placeholder; the XFA layout may have a different page count/size. The frontend ignores metadata sizes when `isPureXfa`. Reporting XFA page count (or a flag) would help.
- **R7.5 forms API on XFA.** `GET /pdf/forms` returns no fields for dynamic XFA. When datasets read/fill lands, please document the field naming (SOM path, e.g. `form1[0].body[0].City[0]`) so the Forms panel can list XFA fields from the server too.
- **R7.6 dynamic-XFA schema (typed client: `packages/editor-client/src/xfa.ts`).** Placeholder `GET /pdf/{id}/forms/xfa/schema?version=` → `XfaSchema`:
  ```ts
  type XfaKind = "none" | "hybrid" | "dynamic";
  type XfaFieldType = "text"|"multiline"|"numeric"|"date"|"checkbox"|"radio"|"choice"|"signature"|"button"|"image"|"barcode"|"other";
  interface XfaLayout { x?, y?, w?, h?: number|null /* pt */; page?: number|null; layout?: "position"|"tb"|"lr-tb"|"rl-tb"|"row"|"table"|null }
  interface XfaField { kind: "field"; name: string; som: string /* full SOM, fill key */; type: XfaFieldType; caption?: string|null;
    binding?: string|null; value?: string|boolean|null; options?: {value: string; label: string}[]|null; required?: boolean;
    read_only?: boolean; max_chars?: number|null; has_scripts?: boolean; layout?: XfaLayout|null }
  interface XfaSubform { kind: "subform"; name: string; som: string; caption?: string|null; repeatable?: boolean; layout?: XfaLayout|null; children: (XfaField|XfaSubform)[] }
  interface XfaSchema { kind: XfaKind; packets: string[]; has_scripts: boolean; root: XfaSubform }
  ```
- **R7.7 fill.** Placeholder `POST /pdf/forms/xfa/fill` `{document_id, expected_version, values: {[som]: string|boolean}}` → `VersionResult` (datasets updated; hybrid AcroForm synced).
- **R7.8 data XML.** Placeholder export `GET /pdf/{id}/forms/xfa/data?version=` → `application/xml` (the `xfa:data` content); import `POST /pdf/forms/xfa/data` multipart `document_id, expected_version, file` → `VersionResult`.
- All of R7.1/R7.6–R7.8 are feature-detected: 404/405 hides the action for the session. Please publish the final paths/shapes and we'll swap the placeholders (single call sites in `http.ts`).

### Update: wired to backend PR #24 (feat/xfa) — branch feat/xfa-backend-wiring
R7.1–R7.8 above are superseded by the real contract in `docs/integration-for-bot1.md` (feat/xfa). Client: `packages/editor-client/src/xfa.ts` (hand-written `XfaInfo`, `XfaSchemaField`, `XfaSchemaOut`, `XfaDataOut`) and `HttpEditorApi.getXfaData/getXfaSchema/fillXfa/exportXfaData (GET …/forms/xfa/data.xml)/importXfaData ({xml})/convertXfaToAcroForm`. The schema is flat; the Forms tool groups fields into subforms client-side by data path. Fill keys = `name` (data path); unbound fields (`name: null`) are shown read-only. Every endpoint is still feature-detected (404/405 without `DOCUMENT_NOT_FOUND` hides the action), so the UI works on main before #24 merges. Error messages: XFA_NOT_PRESENT, XFA_MALFORMED, XFA_UNSAFE_XML, XFA_TOO_LARGE, xfa_dynamic_unsupported (+`details.unsupported`), VERSION_CONFLICT (reload via the existing handler).
Requests from review of #24:
- **R7.9** Check `expected_version` before XFA presence: a stale fill on a since-converted doc returns 422 `XFA_NOT_PRESENT` instead of 409 `VERSION_CONFLICT`.
- **R7.10** `POST /pdf/forms/xfa/data` with a bare record replaces the whole data record (fields not in the XML are cleared; converted output then lost `FullName`/`Agree`). Please document replace-vs-merge, or merge by default / add `mode: "merge"|"replace"`.
- **R7.11** `som` is a dotted path without indices (`form1.body.FullName`), unlike the doc's "SOM" and `acroform_field` (`form1[0].body[0].FullName[0]`); please emit the indexed SOM or rename the field.
- **R7.12** Add `xfa` to `/pdf/{id}/capabilities` (and `XfaInfo`/`XfaSchemaOut` to the published OpenAPI types used by `openapi-typescript`) so the UI can gate actions without probing.
- **R7.13** Subform structure (names/captions/repeatable) isn't in the schema; the frontend infers groups from data paths. Optional `subforms:[{som, name, caption, repeatable}]` would enable proper section headings.
