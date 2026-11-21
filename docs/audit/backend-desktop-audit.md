# THYNKPDF backend / desktop / security / release audit (Bot 1)

| | |
|---|---|
| Audited commit | `7604fc5103ee35976c55bd72dc42922f9aa3d992` (`origin/main`, tag `v0.1.6`, "Latest" release) |
| Release binaries tested | v0.1.5 AppImage (tag `e6c51a43`, digest-verified); v0.1.0 AppImage for the upgrade test; v0.1.6 sidecar probed read-only |
| Audit branch | `audit/backend-desktop` (worktree `/workspace/thynkpdf-audit-backend`) |
| Date | 2026-11-01 (America/Toronto, EDT) |
| Prior review | The review at 7604fc5 was treated as hypotheses only. Everything below was re-derived. |
| Platform actually exercised | Linux x86_64 (Debian 13). Windows and macOS were **not run** (see §Untested). |

Evidence classes: **CONFIRMED** = reproduced here · **SOURCE** = source-level concern, not reproduced · **VERIFIED** = exercised and working · **BLOCKED** = cannot check here · **IMPROVEMENT**.
Commands and raw results are in `backend-test-results.md` and `tools/audit/*.json`.

## Executive summary
The engine core works on Linux. Upload, immutable versions, rotate/reorder/merge/split, Std-14 text replace, form fill/flatten, pyHanko sign/verify and crash consistency all checked out. **The shipped desktop app does not deliver the product the README describes:**
1. **Every released desktop sidecar (v0.1.0 through v0.1.6) is missing 47 of 74 API routes** (annotations, forms, signatures, signing requests, sharing, folders/tags/trash, AI, page delete/duplicate/insert). The PyInstaller build never bundles `thynkpdf_api.features.*`. CI smoke only checks upload, so it passes anyway.
2. **A fresh install has no usable identity.** The DB has 0 users, the UI offers sign-in only, and no local account is provisioned. Server-backed editing needs a developer to call `/auth/register` by hand.

Either one alone fails the Stage 2 acceptance condition ("new user installs, opens, modifies, saves, reopens a PDF without developer setup").

## Verdicts
- **Free public beta: NO-GO.** Blockers: BD-01, BD-02 (P0) and BD-03, BD-04, BD-06 (P1).
  - It becomes **CONDITIONAL GO** once the following hold:
    - BD-01 and BD-02 are fixed and verified on the packaged builds of all 3 OSes.
    - A packaged feature smoke and the backend suite gate the release (BD-03).
    - Remote sharing/signing is hidden or clearly explained on desktop (BD-06).
    - Desktop startup runs migrations with a pre-migration backup (BD-04).
    - The release notes state the unsigned/ad-hoc status.
- **Stable release: NO-GO.** On top of the beta conditions it needs:
  - DNS-rebinding/Host protection (BD-05).
  - Structure-preserving page ops (BD-10).
  - Data-dir permissions (BD-11).
  - Recovery UX (BD-07).
  - Signed Windows/notarized macOS builds, or a documented decision with checksums/provenance (BD-21).
  - Upgrade tests across released schemas (BD-04).
  - Windows/macOS clean-install and uninstall evidence (blocked here).
  - A licence inventory decision (BD-23).

This is not a production-readiness claim. Material checks remain unverified (see §Untested).

## Finding index
| ID | Sev | Class | Title |
|---|---|---|---|
| BD-01 | **P0** | CONFIRMED (Linux); SOURCE (Win/mac) | Packaged sidecar lacks 47/74 API routes (feature modules not bundled) |
| BD-02 | **P0** | CONFIRMED (Linux) | Fresh install: no local identity, sign-in-only UI, no bootstrap |
| BD-03 | **P1** | CONFIRMED (CI metadata) | Release gates do not run the backend suite or exercise features; tagged commits never ran web-e2e |
| BD-04 | **P1** | CONFIRMED | Desktop uses `create_all`, not Alembic; repo migrations fail on desktop DBs; no pre-upgrade backup |
| BD-06 | **P1** | SOURCE + CONFIRMED (port change) | Share and signer links are `http://127.0.0.1:<random port>`, presented as shareable; no email; die on restart |
| BD-05 | P2 | CONFIRMED (precondition) | Local API accepts any Host/Origin (DNS-rebinding precondition); open register; no login throttling |
| BD-07 | P2 | CONFIRMED | Corrupt/unreadable DB → app quits with generic error; no backup or recovery path |
| BD-08 | P2 | CONFIRMED | `text_move` displaces the following text run in the same BT block |
| BD-09 | P2 | CONFIRMED | Duplicate page silently drops annotations/links |
| BD-10 | P2 | CONFIRMED | Reorder/extract/merge drop AcroForm, outlines, attachments, OpenAction; reordered forms become unfillable |
| BD-11 | P2 | CONFIRMED (Linux modes) | App data world-readable (dir 0755, DB 0644) |
| BD-12 | P2 | CONFIRMED | OCR not implemented or packaged, yet capabilities advertise "ocr" |
| BD-14 | P2 | CONFIRMED | No decompression/CPU limits: 0.5 MiB bomb → ~1.2 GiB RSS in-process, sidecar unresponsive 9 s |
| BD-16 | P2 | SOURCE | `shell.openExternal` on any non-internal URL, any scheme |
| BD-17 | P2 | CONFIRMED | Linux AppImage launches with `--no-sandbox` (Chromium sandbox off) |
| BD-18 | P2 | CONFIRMED (source/config) | No file association / Open With / argv/open-file handling |
| BD-19 | P2 | SOURCE | Random port per launch → per-origin browser storage (saved signatures, prefs) lost every restart |
| BD-20 | P2 | CONFIRMED (CI log) | Intel mac sidecar built with MACOSX_DEPLOYMENT_TARGET=15.0; min OS undocumented |
| BD-21 | P2 | CONFIRMED | Unsigned Windows, ad-hoc mac, empty release notes, no checksum file/provenance/SBOM |
| BD-23 | P2 | CONFIRMED (open question) | No repo LICENSE; desktop `UNLICENSED`; bundled third-party notices incomplete |
| BD-27 | P2 | CONFIRMED | Text delete is not redaction; old versions retain content; no redaction feature |
| BD-13 | P3 | CONFIRMED | Compression presets are lossless and nearly identical; "high" is larger than "balanced" |
| BD-15 | P3 | CONFIRMED | Long ops are synchronous with no cancel/progress; worker is a stub, never enqueued or packaged |
| BD-24 | P3 | CONFIRMED | Outdated docs: capability matrix, desktop README CI note; non-deterministic fixtures |
| BD-25 | P3 | CONFIRMED | Missing object / write failure → opaque 500 (consistency itself VERIFIED) |
| BD-26 | P3 | SOURCE | Owner-password (permissions-only) PDFs re-saved without encryption/permissions, silently |
| BD-28 | P3 | SOURCE | External AI key stored as plaintext in `settings.env`; no OS keychain |
| BD-29 | P3 | CONFIRMED (source) | Launcher contacts api.github.com on every launch; undisclosed |

**Counts:** P0 = 2 · P1 = 3 · P2 = 16 · P3 = 7 (28 findings). Verified-working items are listed in §Verified working.

---
## P0
### BD-01: Packaged sidecar is missing 47 of 74 API routes
- **Class / platform:** CONFIRMED on the Linux AppImages v0.1.0, v0.1.5 and v0.1.6. SOURCE for Windows/macOS: same `build_sidecar.py`, and the CI smoke passes only because it touches nothing missing.
- **Refs (7604fc5):**
  - `apps/api/thynkpdf_api/features/__init__.py:3-5` discovers modules with `pkgutil.iter_modules(__path__)`.
  - `apps/desktop/build/build_sidecar.py:15` (`--collect-submodules thynkpdf_api`).
  - `apps/desktop/build/smoke_sidecar.py:1-27`.
- **Repro:** extract the AppImage, start `resources/thynkpdf-server/thynkpdf-server --data-dir <tmp>`, `GET /openapi.json`. Or run `THYNKPDF_AUDIT_SIDECAR=… pytest packages/backend-tests/audit -k BD01`.
- **Expected:** the 74 routes of `create_app()` from source.
- **Actual:** 23 routes. The PYZ contains only `thynkpdf_api.{config,db,features,main,schemas}`; `features.ai/annotations/docmgmt/forms/pages/signing/audit` are absent. `POST /documents/{id}/shares` and `POST /signature-requests` → 405; `/pdf/annotations`, `/pdf/forms/fill` and `/pdf/signatures/place` do not exist.
- **Impact:** in the desktop app, Comment, Forms, Sign, Request signatures, Documents (folders/tags/trash/shares), AI and page delete/duplicate/insert cannot use the backend. Any UI that calls them fails. The README's feature list is not true for installers.
- **Fix:**
  - Register feature modules explicitly (a static import list in `features/__init__.py`), or add `--hidden-import thynkpdf_api.features.<m>` for each module and stop relying on `pkgutil` in frozen builds.
  - Make `smoke_sidecar.py` assert that the packaged route set equals the source route set and call one endpoint per feature.
- **Acceptance:** `test_BD01…` passes against the Win, mac-arm64, mac-x64 and Linux artifacts in CI, and a per-feature smoke (annotate, fill, place signature, share, signing request, folder) returns 2xx on each.
- **Owner:** Bot 1 (build). Bot 2 to re-verify UI tools on the fixed build.

### BD-02: Fresh desktop install has no usable local identity
- **Class / platform:** CONFIRMED (Linux packaged v0.1.5, GUI under Xvfb plus headless sidecar). SOURCE for Win/mac (same code).
- **Refs:**
  - `apps/web/src/components/SignInForm.tsx:6-19` is sign-in only; the shipped bundle has 0 references to `/auth/register`.
  - `apps/api/thynkpdf_api/main.py:125-143` (register/login).
  - `apps/desktop/server/desktop_server.py:23-33`: no provisioning.
  - `apps/desktop/electron/main.js:16-38`.
- **Repro:** `python tools/audit/first_run.py <sidecar>` with a fresh HOME → `users_after_first_start = 0`, login 401. The GUI screenshot (`evidence/v0.1.5-linux-first-launch.png`) shows "Editing requires a document opened through the THYNKPDF server (sign in, then open)".
- **Expected:** the first launch gives the OS user a working local workspace with no email, password, internet or account.
- **Actual:** nobody can sign in. Server tools are unusable without a developer registering through the raw API. With an API-registered account, upload → rotate → edit → download → restart → refresh all work (VERIFIED), so the gap is purely bootstrap and UI.
- **Impact:** fails the acceptance condition for every new user.
- **Fix (secure desktop bootstrap; keep auth on):**
  1. Electron main generates a 256-bit one-time `bootstrap secret` per launch and passes it to the sidecar via an env var or stdin, never in a URL.
  2. The sidecar exposes `POST /desktop/session`. It is enabled only when started in desktop mode, requires the secret plus Host `127.0.0.1:<port>` plus Origin = app origin, and idempotently provisions a single local user/org (the OS user, random unusable password hash) on first call. It returns the normal access/refresh tokens and sets the httpOnly refresh cookie.
  3. Electron injects the secret only into requests from its own `webContents` (preload `contextBridge` exposing `getDesktopSession()`, or `session.webRequest.onBeforeSendHeaders` scoped to the app origin). Web pages in other browsers never get it.
  4. Keep JWT auth, roles and tenant checks unchanged. Disable `/auth/register` and password login in desktop mode, or put them behind an explicit "multi-user" setting.
  5. Pair this with BD-05 (Host/Origin allowlist). A local bootstrap without it widens the rebinding surface.
- **Acceptance:** packaged app, fresh HOME/profile, offline (network namespace with no route): open a PDF → text replace → save → quit → relaunch → the document and 2 versions are listed and reopen with no prompt. Repeat on Win and mac. A second OS user on the same machine cannot obtain a session (requires BD-11).
- **Owner:** Bot 1 (sidecar + Electron). Bot 2 (UI: drop the sign-in panel in desktop mode, first-run empty state). Shared API contract change: agree in `handoff.md`.

## P1
### BD-03: Release gates do not test what ships
- **Class:** CONFIRMED (workflow files plus run list).
- **Refs:**
  - `.github/workflows/desktop-release.yml:52-61` runs a pip install, the PyInstaller build and `smoke_sidecar.py`, with **no pytest**.
  - `.github/workflows/web-e2e.yml:4-6` triggers on pull_request/workflow_dispatch only, also with no pytest.
  - `apps/desktop/build/smoke_sidecar.py`.
- **Evidence:**
  - Tag v0.1.5 (e6c51a43): desktop-release run 41262051796 succeeded, and there is no web-e2e run for that SHA.
  - Tag v0.1.6 (7604fc51): run 41268428967 succeeded, and again no web-e2e run.
  - The backend suite (85 tests) never runs in CI.
- **Impact:** BD-01 shipped in seven releases. A build going green says nothing about features, migrations or upgrades.
- **Fix:** run, on the tag commit and before upload:
  - `pytest`.
  - The audit regression subset.
  - A packaged smoke per OS: the route-set check plus per-feature calls plus output-PDF verification with pypdf/qpdf.
  - An upgrade test: launch the previous release's sidecar, create data, then start the new one.
  - Electron launch under Xvfb on Linux.
  - web-e2e on `push: tags`.
  - Make the `release` job `needs:` all of these.
  - Pushing workflow changes needs the `workflow` token scope, which the current gh token lacks.
- **Acceptance:** a tag run fails if any route is missing or the suite fails, and the CI page shows the test jobs on the exact tag SHA.
- **Owner:** Bot 1 (workflows); Bot 2 (web-e2e trigger).

### BD-04: Desktop schema managed by `create_all`; migrations cannot apply later
- **Class:** CONFIRMED.
- **Refs:** `apps/api/thynkpdf_api/db.py:93-96` (`create_all` in `make_session_factory`); `apps/desktop/server/desktop_server.py:23-33` (no migration step); `scripts/migrate.py`; `migrations/versions/*` (5 revisions).
- **Repro:** `python tools/audit/upgrade_recovery.py <v0.1.0> <v0.1.5> /tmp/x`.
  - The desktop DB has no `alembic_version`.
  - `alembic upgrade head` on it → `sqlite3.OperationalError: table audit_events already exists` (rc 1).
  - Today the fresh Alembic schema equals the `create_all` schema, so the v0.1.0 → v0.1.5 upgrade worked: login, versions and download all preserved (VERIFIED).
- **Expected:** desktop startup brings any older DB to head safely.
- **Actual:** `create_all` adds missing tables only. A new or changed column in a future release will not be applied, and the sidecar will fail at query time (500 errors) on upgraded installs. Alembic cannot take over without a stamp step.
- **Fix:** at sidecar startup in desktop mode:
  1. Take a file lock.
  2. If there is no `alembic_version` but tables exist, verify the schema matches the baseline revision and `alembic stamp` it.
  3. Copy `thynkpdf.db` to `backups/thynkpdf-<oldrev>-<ts>.db` using SQLite's online backup API, and keep the last N.
  4. Run `alembic upgrade head` in one transaction (SQLite batch mode).
  5. On failure, do not start the API in write mode. Show "Update could not migrate your library. Your data is unchanged; backup at …", offer to open the data folder, and **do not auto-restore or auto-downgrade**.
  6. Refuse to open a DB whose revision is newer than the code knows (a downgrade guard).
  7. Remove `create_all` from production paths and keep it only in tests.
- **Acceptance:** CI upgrade matrix of v0.1.0, v0.1.5 and the previous release DBs with documents, annotations, form values, signatures and settings → new build. Every document, version sha256 and setting is preserved. A deliberately broken migration leaves the DB byte-identical and the app shows the message.
- **Owner:** Bot 1.

### BD-06: Desktop share and signer links are localhost, ephemeral, and never delivered
- **Class:** SOURCE for desktop (the routes are absent in packaged builds per BD-01, so this cannot be reproduced there). CONFIRMED that the port changes on every launch (`port_changed = true`). Remote recipient: BLOCKED (no second device), but the behaviour is deterministic: 127.0.0.1 is the recipient's own machine.
- **Refs:**
  - `apps/web/src/lib/publicLinks.ts:5-6` and `RequestSignatures.tsx:47-48` / `SharePanel.tsx:26` build links from `window.location.origin`.
  - `apps/api/.../signing.py:229-231` (`notification_queued … delivered: False`; links "returned ONCE — email delivery is not configured").
  - `docmgmt.py:171-175`.
  - `electron/main.js:21` (`--port 0`).
- **Expected:** on desktop, remote features are either hidden or clearly labelled "this link only works on this computer while THYNKPDF is open".
- **Actual (source):** the UI shows links like `http://127.0.0.1:48239/shared/?token=…` as shareable. No email is sent. After a restart the token is still valid in the DB, but the URL's port is dead, so even the owner's copied link fails.
- **Impact:** users send links that cannot work and may believe a signature request went out.
- **Fix:**
  - In desktop mode, hide "Create public link" and "Request signatures (remote)". Instead offer "Export a copy" and "Sign on this device" (in-person signing).
  - Show the visual-vs-digital-vs-remote distinction explicitly. The UI already labels "Visual e-signature only — not a cryptographic digital signature", which is good.
  - If remote signing is wanted later, it needs a separately hosted, opt-in relay. **Never bind the sidecar to 0.0.0.0 or tunnel it.**
- **Acceptance:** in the packaged desktop, no UI surface produces a 127.0.0.1 URL intended for another person, and a test asserts that `/signature-requests` and link-share creation are disabled (or return `DESKTOP_LOCAL_ONLY`) in desktop mode.
- **Owner:** Bot 2 (UI), Bot 1 (desktop-mode flag on the API).

## P2
### BD-05: No Host/Origin validation on the localhost API (DNS-rebinding precondition)
- **CONFIRMED precondition**, exploit not demonstrated.
- **Refs:** `desktop_server.py:82` (uvicorn, no TrustedHostMiddleware); `main.py:37-39` (CORS only); `main.py:125-143` (open register, no rate limit).
- **Repro (`first_run.py`):**
  - `Host: attacker.example` → 200.
  - `POST /auth/register` with Origin and Host = attacker.example → 201.
  - 30 bad logins → 30× 401, no throttle.
- **Prerequisites for abuse:** the victim visits a malicious page that rebinds its hostname to 127.0.0.1 and finds the random port (a scan of the ephemeral range is feasible but slow).
- **Impact today:** the attacker can create tenants and run heavy PDF ops (DoS), and can brute-force the local account's password, which would expose documents. Existing data is otherwise protected by bearer tokens; CSRF via cookie is limited to `/auth/refresh`, whose cookie is SameSite=Strict on path `/auth` (SOURCE).
- **Fix:**
  - Allow only `Host` ∈ {`127.0.0.1:<port>`, `localhost:<port>`} (TrustedHostMiddleware or a tiny middleware).
  - For state-changing requests, require `Origin` to be absent or equal to the app origin.
  - Add a login rate limit/backoff.
  - Disable `/auth/register` in desktop mode (see BD-02).
- **Acceptance:** `test_BD05` passes, a foreign-Origin POST gets 403, and the 11th failed login within a minute gets 429.
- **Owner:** Bot 1.

### BD-07: Corrupt or unreadable DB stops the app with no recovery
- **CONFIRMED.**
- **Refs:** `electron/main.js:32-35`; `db.py:93-96`.
- **Repro:** overwrite `thynkpdf.db` → the sidecar exits 1 before READY, and Electron shows "The THYNKPDF engine stopped (code 1). See …/server.log" and quits.
- **Expected:** a clear error, the original file untouched, and options to open the data folder or restore the latest backup (BD-04).
- **Fix:** run `PRAGMA quick_check` at startup and give a specific exit code/message. Offer "restore from backup" only as a user-confirmed action that keeps the damaged file aside.
- **Acceptance:** a corrupt-DB fixture yields the dialog with both options, and the bytes are unchanged.
- **Owner:** Bot 1.

### BD-08: `text_move` shifts the following run
- **CONFIRMED.**
- **Ref:** `packages/pdf-engine/thynkpdf_engine/edit.py:49`. The engine wraps the run in `dx dy Td … -dx -dy Td`. `Td` resets the text matrix to the line start, so the advance width of the moved run is lost.
- **Repro:** `two_runs.pdf` ("Alpha " then "Beta" in one BT) → move "Alpha" by (0, 50) → "Beta" jumps from x=106 to x=72 and overlaps (PyMuPDF word boxes). Test: `test_BD08`.
- **Fix:** emit an explicit `Tm` restore based on the tracked text matrix, or isolate the moved run in its own BT with an absolute `Tm` and leave the following operators untouched. Otherwise refuse the move when more text-show operators follow in the same BT.
- **Acceptance:** `test_BD08` passes, and the positions of all other words are unchanged (±0.5 pt).
- **Owner:** Bot 1.

### BD-09: Duplicate page drops annotations and links
- **CONFIRMED.**
- **Ref:** `edit.py:116-117,122-124` (`/Annots` excluded; the code comment admits it).
- **Repro:** duplicate page 1 of `annots_links_bookmarks_attach_js.pdf` → the copy has 0 annotations (the source page has 2).
- **Fix:** deep-copy `/Annots` with new `/NM`, re-point `/P`, `/Popup` and `/IRT`, and for widgets create new field names or kids. Alternatively return a warning in the response that the UI must show.
- **Acceptance:** `test_BD09` passes, and annotation count and types match on the copy.
- **Owner:** Bot 1; Bot 2 to surface any warning.

### BD-10: Reorder/extract/merge lose document-level structures
- **CONFIRMED.**
- **Refs:** `engine.py:136-143` (reorder builds `Pdf.new()`), `152-166` (extract/merge).
- **Repro:** `engine_checks.py` P-reorder: outline 3→0, attachments 1→0, OpenAction removed. Reordering `acroform.pdf` leaves **no `/AcroForm`** (widgets orphaned, and pikepdf warns). Merge has the same problem.
- **Impact:** reordering pages of a form makes it unfillable in other readers, and bookmarks and attachments disappear without warning. The old version is still in history, which mitigates the loss.
- **Fix:** reorder in place (`pdf.pages` permutation on the same `Pdf`). For merge/extract, use `Pdf.add_pages_from()` or copy `/AcroForm` fields (with renaming), outlines (re-targeted) and the EmbeddedFiles name tree, or warn explicitly.
- **Acceptance:** the `test_BD10*` tests pass, and pypdf `get_fields()` is identical before and after a reorder.
- **Owner:** Bot 1.

### BD-11: App data readable by other OS users
- **CONFIRMED** (Linux modes); Windows/mac BLOCKED.
- **Ref:** `desktop_server.py:24-27`. Only `jwt-secret` gets 0600.
- **Repro:** fresh run → data dir 0755, DB 0644, objects 0755. Whether this exposes files depends on HOME's mode; many distros use 0750/0700, some 0755.
- **Fix:** `umask(0o077)` in the sidecar, plus `chmod 0700` on the data dir and 0600 on files. On Windows, `%APPDATA%` is per-user by ACL; verify on a Windows runner.
- **Acceptance:** with another local user and HOME at 0755, `cat` of the DB and objects is denied.
- **Owner:** Bot 1.

### BD-12: OCR absent but advertised
- **CONFIRMED.**
- **Refs:** `engine.py:121` (`safe_alternatives: "ocr (when text layer absent)"`). No OCR route exists, there is no tesseract/ocrmypdf in the AppImage (`find` returned 0 hits), and the capability matrix says BLOCKED.
- **Fix:** remove "ocr" from the alternatives until it ships. If it is added, bundle Tesseract (Apache-2.0) in-process via a separate binary. Avoid Ghostscript (AGPL) unless that has been reviewed.
- **Acceptance:** capabilities output contains no OCR claims, or an OCR round-trip test makes `pdftotext` find text on `scan_image_only.pdf`.
- **Owner:** Bot 1; Bot 2 to check for UI copy that mentions OCR.

### BD-14: Decompression and CPU limits
- **CONFIRMED.**
- **Refs:** `engine.py:14` (MAX_PAGES 5000 only); `main.py` `max_upload` of 100 MiB.
- **Repro:** `flate_bomb_512MiB.pdf` (0.5 MiB) uploads fine. `compress(high)` then takes 9 s, and `/health` latency hits 8.9 s. In-process, max RSS rose from 189 to 1225 MiB. A 4×2000-page merge does 4.3 s of work before failing PDF_TOO_MANY_PAGES with a generic 400.
- **Impact:** a crafted file can freeze or OOM the app; on a desktop the attacker is limited to a file the user opens.
- **Fix:** run heavy ops in a subprocess with RLIMIT_AS/time limits (or check the predicted page sum before merging), and cap decoded stream size during `remove_unreferenced_resources`/recompress. Map PDF_TOO_MANY_PAGES to 413/422.
- **Acceptance:** the bomb is rejected or processed under a 512 MiB cap, and `/health` stays under 200 ms during heavy work.
- **Owner:** Bot 1.

### BD-16: `shell.openExternal` with arbitrary schemes
- **SOURCE.**
- **Ref:** `electron/main.js:51-53`. Any non-internal URL from `window.open` or navigation goes to `shell.openExternal`, including `file:`, `smb:`, custom protocol handlers and `javascript:`-like schemes, depending on the OS.
- **Prerequisite:** content in the renderer that can trigger navigation, such as a PDF link annotation rendered as an anchor, or an XSS. Not reproduced: no renderer link path was found in `apps/web` at this commit.
- **Fix:** allow only `https:` (and `mailto:` if needed); show a confirm dialog for any other scheme. Also set `will-redirect` and `webContents.on('will-attach-webview', prevent)`.
- **Acceptance:** a unit test of the handler with `file:///etc/passwd` and `smb://x` → denied.
- **Owner:** Bot 1.

### BD-17: AppImage disables the Chromium sandbox
- **CONFIRMED.**
- **Ref:** the generated `thynkpdf-desktop.desktop` has `Exec=AppRun --no-sandbox %U` (electron-builder default). `sandbox: true` in `main.js:48` is then not enforced at the OS level.
- **Fix:** ship a properly permissioned `chrome-sandbox` path or rely on user namespaces (document the AppArmor profile on Ubuntu 24.04+), and drop `--no-sandbox` where it is supported.
- **Acceptance:** on Ubuntu 22.04/24.04, `chrome://sandbox` (or the `--enable-logging` output) shows the namespace sandbox active.
- **Owner:** Bot 1.

### BD-18: No "Open With" or file association
- **CONFIRMED** (config/source); OS behaviour BLOCKED.
- **Refs:** `apps/desktop/package.json` has no `fileAssociations`. `main.js` ignores `process.argv`, `open-file` and `second-instance` argv. The `.desktop` file has no `MimeType=application/pdf`.
- **Fix:** add `fileAssociations` (pdf), handle argv and `open-file`, and upload the file to the local workspace on open.
- **Acceptance:** `THYNKPDF file.pdf` opens the document on each OS.
- **Owner:** Bot 1 (shell); Bot 2 (open flow).

### BD-19: Random port breaks per-origin browser storage
- **SOURCE.**
- **Refs:** `main.js:21` (`--port 0`); `apps/web/src/lib/sigStore.ts` (IndexedDB saved signatures); `annotState.ts:19` / `EditorShell.tsx:84` (localStorage).
- **Effect:** the origin `http://127.0.0.1:<port>` changes on every launch, so saved signatures, author name and theme vanish. Cookies are not port-scoped, so refresh survives; API-level refresh across restarts was VERIFIED.
- **Fix:** serve the UI via a custom privileged protocol (`app://thynkpdf`) proxied to the sidecar, or persist a fixed preferred port with fallback. Keep the BD-05 Host checks either way.
- **Acceptance:** save a signature, restart, and it is still listed.
- **Owner:** Bot 1 (shell); Bot 2 to verify.

### BD-20: Intel mac minimum OS
- **CONFIRMED** (CI log run 41262051796: `MACOSX_DEPLOYMENT_TARGET: 15.0`); runtime BLOCKED.
- **Ref:** `.github/workflows/desktop-release.yml:47`.
- **Effect:** the native wheels built for x86_64 (pikepdf, cryptography) likely require macOS 15, while the README says "Mac with Intel" with no minimum.
- **Fix:** pin it to the lowest version supported by Electron 38 (macOS 12), or document "macOS 15+ (Intel)". Add `LSMinimumSystemVersion`.
- **Acceptance:** `otool -l` minos on bundled `.so` files ≤ the documented minimum, and a launch on that OS in CI.
- **Owner:** Bot 1.

### BD-21: Release integrity and signing
- **CONFIRMED.**
- **Facts:**
  - Releases v0.1.0–v0.1.6 have empty bodies.
  - Assets have GitHub-computed sha256 digests (API), but there is no checksum file, no build provenance attestation and no SBOM.
  - Windows is unsigned (SmartScreen) and mac is ad-hoc signed, not notarized; this is documented in the READMEs.
  - The release job creates a **draft**, and a human published it.
  - Tag = main HEAD for v0.1.6, and the tag SHA matches the desktop-release run SHA, but no test run exists on that SHA (BD-03).
- **Fix:**
  - Publish `SHA256SUMS`, plus `actions/attest-build-provenance`, plus release notes with the known limitations.
  - The free options for signing are SignPath Foundation for OSS, or keeping ad-hoc builds with documented checksums. Purchasing anything is a user decision and was not done.
- **Owner:** Bot 1 / maintainers.

### BD-23: Licensing inventory open questions (no legal conclusion)
- **CONFIRMED facts:**
  - The repo has no LICENSE file, and `apps/desktop/package.json` says `"license": "UNLICENSED"`, while the README says the app is "free".
  - The AppImage ships `LICENSE.electron.txt` and `LICENSES.chromium.html` plus 18 Python `LICENSE*` files inside dist-info. It also bundles OpenSSL 3 (`libssl/libcrypto`), libqpdf (Apache-2.0, NOTICE) and pyHanko, with no aggregated third-party notice file.
  - `docs/licensing.md` lists PyMuPDF as "NOT USED". This audit uses it only as an external test validator (not committed as a dependency).
- **Questions for maintainers:**
  - The intended project licence.
  - Whether NOTICE requirements (qpdf, Apache-2.0 deps) are met in installers.
  - Licences of the web fonts and icons shipped in `web/fonts` (Bot 2 should check `apps/web/LICENSES.md`).
- **Owner:** maintainers.

### BD-27: Deleted text is not redaction
- **CONFIRMED.**
- **Refs:** `edit.py:23-27` (delete = replace with "" inside one run only); immutable versions keep the original bytes (by design).
- **Repro:** E2 removes "Invoice total " from the run, but the original version still holds it and other runs or metadata are untouched.
- **Fix:** never label delete as "redact". If redaction is added, it must remove glyphs, images and metadata, purge history versions, and be verified with independent extraction.
- **Owner:** Bot 2 (wording), Bot 1 (engine).

## P3
- **BD-13 (CONFIRMED): compression presets.**
  - Results, original → low / balanced / high:
    - `image_heavy`: 402,074 → 321,767 / 321,546 / 322,396.
    - `std_text`: 2,641 → 2,338 / 1,554 / 2,641 (original kept; raw "high" was 2,783).
    - 2000-page: 1,587,470 → 1,378,704 / 893,409 / 1,316,902.
  - "high" adds linearization and is consistently larger than "balanced". All presets are lossless; there is no image downsampling.
  - **The keep-original guard is VERIFIED** (`engine.py:233-234`, `main.py:499-505`).
  - Fix: rename the presets (e.g. "Standard" and "Web-optimized"), or implement lossy image downsampling with a preview.
- **BD-15 (CONFIRMED): no background jobs.**
  - All ops are synchronous. `/health` latency reached 863 ms during a 2×2000-page merge and 8.9 s during the bomb.
  - `apps/worker/worker.py` has `HANDLERS = {}`, nothing enqueues, there is no cancellation, timeout or retry, and the worker is not packaged.
  - For a local single-user app, the simplest fix is a subprocess-per-heavy-op with a timeout and kill-to-cancel. A Redis/Celery stack is not needed.
  - Delete the stub worker or wire it later.
- **BD-24 (CONFIRMED): outdated docs.**
  - `capability-matrix.md` says "11 passed" (it is 85), "Jobs IN PROGRESS", and marks features TESTED that are absent from installers (BD-01).
  - `apps/desktop/README.md` says to copy `ci/desktop-release.yml`, but `.github/workflows/desktop-release.yml` already exists and has diverged (the Intel and mac verify steps are missing from the ci/ copy).
  - The fixture generators are non-deterministic.
- **BD-25 (CONFIRMED): opaque errors on storage failures.**
  - A missing object or a read-only store returns a generic 500 INTERNAL_ERROR and nothing is logged to the user.
  - **Consistency is VERIFIED:** no partial version on write failure, and after SIGKILL mid-merge there were 0 orphan files or rows, and `integrity_check` passed.
  - Fix: map `FileNotFoundError` to `STORAGE_OBJECT_MISSING` and `OSError(ENOSPC/EACCES)` to `STORAGE_WRITE_FAILED`, with a log line. Add `fsync` before `os.replace` (`thynkpdf_storage/__init__.py:44-45`).
- **BD-26 (SOURCE): permissions-only encryption dropped silently.** An owner-password-only PDF opens (`encrypted_ownerpw_only.pdf`) and `_save` writes it without encryption. Warn the user, or preserve it via `encryption=` on save.
- **BD-28 (SOURCE): AI key storage.** `THYNKPDF_AI_EXTERNAL_API_KEY` lives in plaintext `settings.env`. The opt-in requires `acknowledge_external_processing` (VERIFIED by `test_ai.py`). Prefer OS keychain storage (keytar/safeStorage) and show the provider host in the consent text.
- **BD-29 (CONFIRMED, source): launcher update check.** `launcher.js:23` fetches `api.github.com/…/releases/latest` on every launch, which sends the user's IP to GitHub. No other outbound calls were found in desktop mode (AI is off unless configured). **"Files stay on your computer" is accurate for documents in desktop mode**, but disclose the update check and add a toggle. In hosted or web mode, documents go to whichever server `NEXT_PUBLIC_API_URL` points to, so state that in web mode.

## Verified working (exercised here)
- 85/85 backend tests (local, Python 3.13), including cross-tenant denial, token typ/expiry, refresh rotation with replay → TOKEN_REVOKED, logout and viewer-role limits.
- Packaged v0.1.5 on Linux:
  - AppImage launches under Xvfb.
  - Sidecar ready in about 1 s.
  - Upload, rotate, text replace and download all work.
  - Versions persist across a restart and a port change.
  - The refresh token works after restart.
  - The v0.1.0 → v0.1.5 data upgrade preserves documents and history.
  - SIGKILL mid-operation leaves the DB and storage consistent.
  - Storage writes are atomic (tmp + `os.replace`).
- Engine:
  - Std-14 replace is verified by pypdf and poppler.
  - Embedded/CID fonts are refused safely (EDIT_NOT_SUPPORTED).
  - Unicode outside WinAnsi is refused safely.
  - AcroForm fill and flatten work.
  - pyHanko sign → verify is intact, and tamper/rotate → intact=false.
  - Signed docs are detected, and the API blocks modifying ops (`writable()`; `main.py:410-418`).
  - Encrypted (user password), garbage and no-pages files fail with typed errors.
  - XFA XXE → `XFA_UNSAFE_XML`.
  - Compression never grows the file.
- Electron: `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true` (`main.js:48`), a single-instance lock, sidecar bound to 127.0.0.1, and the sidecar exits when stdin closes (stop_exit 0).

## Untested platforms and capabilities
- **Windows (NSIS x64) and macOS (arm64 and x64 dmg)** were not run here. CI shows build plus sidecar smoke success only. BD-01 and BD-02 almost certainly apply there too (same build script), but that is unverified.
- Clean install, uninstall (does NSIS remove `%APPDATA%`?), in-place update, Gatekeeper and SmartScreen flows, and Open With: none were checked.
- Full Electron UI workflows (open → modify → save → reopen in the GUI) and the time to first page were not driven. This is Bot 2's area. Only the first-launch screen was captured.
- Remote recipient on another device (BD-06), real email (none exists), Postgres, S3/MinIO, the hosted docker-compose, a real LLM provider, OCR (absent), TSA timestamps and CA-trusted signing certs.
- Real disk-full (only a read-only dir was simulated) and multi-OS-user access (only file modes were checked).
- XFA on real government forms: the matrix claims 13/13, but those forms are not in the repo and were not re-run.

## Recommended repair order
1. **BD-01** Bundle and statically register the feature modules, and add the route-set assertion to the smoke test. This takes hours, and nothing else is testable on desktop until it is done.
2. **BD-02 + BD-05** Desktop bootstrap session plus a Host/Origin allowlist plus login throttling, designed together.
3. **BD-03** Release gates on the tag SHA: pytest, packaged per-feature smoke, upgrade test, web-e2e. Needs the `workflow` scope.
4. **BD-04 + BD-07** Alembic at startup with stamp, backup and a non-destructive failure UX.
5. **BD-06 + BD-19** Desktop-mode hiding of remote features, and a stable app origin.
6. **BD-10, BD-09, BD-08** Structure-preserving page ops and the move fix (the audit tests already exist).
7. **BD-11, BD-14, BD-16, BD-17** Hardening.
8. **BD-18, BD-20, BD-21, BD-23** Distribution polish: file association, min-OS, checksums/provenance, licence.
9. P3 items, and docs refresh (BD-24) last, from fresh evidence.
