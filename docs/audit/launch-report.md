# THYNKPDF free-launch readiness report (consolidated)

Written 2026-11-01 at about 01:10 EDT by Bot 2 (frontend/UX/a11y/E2E).

**Commits audited:**
- `7604fc5` (v0.1.6): the previous review's commit.
- `bc7ee6bc` (v0.1.7): main at the time of writing.
- Release AppImages v0.1.6 and v0.1.7 on Linux, using a real local backend and the real sidecar.

**Bot 1 evidence:** quoted unchanged from PR #32 (`audit/backend-desktop`), via `handoff-bot1.md`. Its classifications are not altered here.

## Verdict
- **Public beta: NO-GO** on the current main/v0.1.7. It becomes **CONDITIONAL GO** once backlog items 1–6 below are fixed and re-verified with the smoke checklist.
- **Stable release: NO-GO.** It additionally needs items 7–14, Windows and macOS runs, native file handling, a screen-reader pass, and CI gates (BD-03).

Bot 1's verdict, verbatim: "free public beta **NO-GO** (CONDITIONAL GO after the P0/P1 fixes); stable release **NO-GO**". The two verdicts agree.

## Counts (Bot 2 findings FUX-01…19)
**By severity:**
- Blocker: 2. FUX-01 (fixed in v0.1.7, regression risk from PR #33) and FUX-02.
- High: 4. FUX-03, 05, 09, 10.
- Medium: 9. FUX-04, 06, 07, 11, 12, 13, 18, 19, and 15 as an improvement.
- Low: 4. FUX-08, 14, 16, 17.

**By category:**
- Confirmed defect: 14. FUX-01, 02, 04–14, 17, 19, with FUX-01 now verified fixed.
- Source-level concern: 3. FUX-03, 16, 18.
- Product improvement: 1. FUX-15.
- Blocked/unverified observations: 2. O-1, O-2. Many matrix cells are ⛔; see the journey file.
- Verified-working items: 17, listed below.

**Bot 1 (verbatim counts):** P0 2 · P1 3 · P2 16 · P3 7.

## Confirmed launch blockers
1. **BD-01 / FUX-02.** The packaged sidecar serves 23 of 74 routes. On v0.1.7 the desktop shows `HTTP_404`/`HTTP_405` for forms, signature requests and AI, and a fillable form appears to have no fields. Evidence: `evidence/bc7ee6b/desktop017-05-forms-raw-404.png`.
2. **FUX-09.** There is no unsaved-changes guard. v0.1.7 local page ops and annotations are silently discarded on close or reload.
3. **BD-02 / FUX-01.** Fixed in v0.1.7: auto local account on desktop, local page ops on the web. **Open PR #33 reverts it.** Do not ship a build where this test fails.
4. **FUX-10 / BD-19.** A desktop restart loses saved signatures and settings and does not reopen the document.

Bot 1 P1 items, verbatim:
- BD-03: release gates run no backend tests, and the tag SHAs have no web-e2e run.
- BD-04: desktop uses `create_all`, not Alembic; `alembic upgrade` fails on desktop DBs; there is no backup.
- BD-06: share and signer links are 127.0.0.1:<random port>, no email is sent, and the links die on restart.

## Verified features (evidence this run)
- Local PDF reading: picker and drag/drop, search (320 pages in about 0.4 s), zoom/fit, thumbnails, mixed-size and rotated pages, keyboard shortcuts.
- Page organization on the web with the real backend: rotate, reorder, duplicate, insert, delete with confirmation, merge, split, extract (E2E, 61/61 at 7604fc5). v0.1.7 local rotate output verified with pypdf.
- Annotations, threads and save, verified with PDF.js and qpdf (E2E). Visual signature by drawing or typing, including on a rotated page.
- Server form fill: text, radio, dropdown and multiline values confirmed with pypdf. XFA render and save (E2E).
- Single-run text replacement, verified with pdftotext. Compression reduces size for real.
- Versioning keeps the original. 409 conflict recovery. Session restore on web reload.
- A backend outage never shows a false success, and retry does not duplicate.
- Honest copy: "Visual e-signature only — not a cryptographic digital signature", "No email is sent", and AI panel "Excerpt mode", with accurate page citations.
- Large-document performance: first page in about 0.7 s, heap stable at about 15 MB over 5 reopens.

## Source-level concerns needing reproduction
- **FUX-03 / BD-06:** loopback share and signer links on desktop.
- **FUX-18:** no file associations, argv or `open-file` handling (hand test: Bot 1 R1).
- **FUX-16:** multiline fields get a single-line input.
- **BD-08/09/10** (Bot 1): text move displaces neighbouring text; page ops drop annotations, forms and bookmarks.
- **O-1:** an unexpected Organizer overlay. **O-2:** the page indicator after a programmatic scroll.

## Untested features and platforms
- **Windows and macOS:** no run at all.
- **Electron packaging:** not rebuilt locally; the released AppImages were used instead.
- **Not run:**
  - Upload-image signature.
  - Undo/redo and clipboard in the UI (unit tests only).
  - Annotation coordinates across the zoom matrix.
  - Checkbox fill in my run.
  - The no-reduction compression message.
  - Encrypted PDFs.
  - Interrupted upload, disk-full, and crash recovery.
  - Desktop document-management actions.
  - BYO AI consent flow (no API key).
  - A screen reader.
  - 200% text-only zoom.
  - Firefox and WebKit for the new v0.1.7 UI.
  - The 200% status-bar variant (inconclusive).

## Ordered repair backlog (by user harm)
| # | Harm class | Item | Owner |
|---|---|---|---|
| 1 | Data loss | FUX-09: unsaved-changes guard on the web (`beforeunload`) and in Electron (`close` dialog) | web + Bot 1 |
| 2 | Data loss | FUX-10/BD-19: stable desktop origin, and persist the last document | Bot 1, then web |
| 3 | Data loss/unsafe | BD-04 desktop migrations and backup; BD-09/10 page ops dropping forms and annotations, or warn first (Bot 1) | Bot 1 |
| 4 | Can't use/save | BD-01/FUX-02: bundle the feature routes, add a route-count smoke test; UI falls back to local forms when a route is missing | Bot 1 + web |
| 5 | Can't use | Keep FUX-01 fixed: block PR #33, or land its replacement first, and keep the `FUX-01` test green | release owner |
| 6 | Can't save (discoverability) | FUX-11: global "Unsaved changes — Save a copy" bar; `-edited.pdf` naming | web |
| 7 | Misleading/sharing | FUX-03/BD-06: hide or label links on desktop | web + Bot 1 |
| 8 | Misleading | FUX-05: warn when replacement text won't fit. FUX-04: rename "Ask AI" while in excerpt mode | web (+engine) |
| 9 | Common failures | FUX-06 plain-language errors; FUX-07 status-bar banner; FUX-17 stale status; FUX-18 native file open | web, Bot 1 |
| 10 | Common failures | FUX-19/BD-03: fix the E2E contract, run web-e2e on main and tags, gate releases | Bot 1 |
| 11 | A11y | FUX-12 dialog focus trap and restore; FUX-13 toolbar overflow at 200%; FUX-14 axe landmarks/h1; FUX-16 textarea for multiline | web |
| 12 | Perf | Set budgets from the baseline (first page < 1.5 s, search on 300 pages < 1 s). Profile BD-14/15 sidecar stalls | web, Bot 1 |
| 13 | Cosmetic | FUX-08 compress display; FUX-15 editing caveat on the tile | web |
| 14 | Platform | Windows and macOS smoke runs; screen-reader pass | both |

## Recommended free-launch scope
- **Feature prominently** (verified):
  - Reading and search.
  - Page organization: web now; desktop once BD-01 is fixed, since rotate/reorder/merge/split/extract routes exist.
  - Annotations.
  - Form filling (web and local; desktop after BD-01).
  - Visual signature.
  - Save as a copy with versions.
- **Mark as limited:**
  - Text editing: only single-run text in standard fonts; no overflow check (FUX-05).
  - Compression: the result varies.
- **Defer or hide on desktop:**
  - Public links and remote signature requests (FUX-03).
  - "Ask AI" naming until a model is configured (FUX-04).
  - OCR: none exists.
  - Redaction: none; text delete is not redaction (BD-27).
  - Advanced conversions: not present.

Working features are not removed. Deferral means hiding or relabelling until the evidence changes.

## Suggested user-facing wording
- **Local privacy:** "Your files stay on this computer. THYNKPDF works offline and never uploads documents unless you turn on an online feature."
- **Unsupported editing:** "This text can't be edited here. It may use a special font or be split inside the PDF. You can add a text box or comment instead."
- **Scanned documents:** "This page is a scanned image, so its text can't be searched, edited or asked about yet."
- **No compression gain:** "This file is already well compressed. We kept your original because a smaller version wasn't possible."
- **Unsaved changes:** "You have unsaved changes. Save a copy before closing? [Save a copy] [Discard] [Cancel]"
- **Failed save:** "Your changes couldn't be saved and your document was not changed. Check that THYNKPDF is still running, then try again. [Details]"
- **Desktop sharing limits:** "Links made here only work on this computer while THYNKPDF is open. To share, export the PDF and send the file."
- **Optional external AI:** "Answers come from keyword search in this document. To get written answers, you can connect your own AI provider. Its text will then be sent to that provider."

## Manual smoke checklist (non-technical tester)
1. Download the installer for your computer from the Releases page, install it, and open THYNKPDF. **Pass:** you see "What would you like to do?" and nothing asks you to sign in.
2. Click **Open PDF** and choose any PDF. **Pass:** the first page appears within about 2 seconds.
3. Type a word you can see into **Search**. **Pass:** it is highlighted and the counter shows the number of matches.
4. Click **Organize**, rotate page 1, and delete page 2 (confirm when asked). **Pass:** the pages change, and you can see how to save.
5. Save or export. **Pass:** you are told where the file went, and its name differs from the original. Open the saved file in another PDF reader (Edge, Chrome or Preview). **Pass:** page 1 is rotated and page 2 is gone. The original file is unchanged.
6. Open a PDF form, fill a name, tick a checkbox, pick a dropdown value, and save. **Pass:** the values show in another reader. No red error text with codes like "HTTP_404" appears.
7. Make a signature (draw it), place it on the page, and save. **Pass:** it appears in the saved file. The app says it is a visual signature, not a digital certificate.
8. Add a highlight, then close the window without saving. **Pass:** you are asked whether to save.
9. Quit and reopen the app. **Pass:** your saved signature is still offered, and your theme choice is kept.
10. Open "Ask" on a document and ask a question. **Pass:** the answer is clearly labelled as quoted passages, unless you connected your own AI, and the page links jump to the right page.
11. Try a scanned PDF (a photo of a page). **Pass:** a plain message says the text can't be read. No codes.
12. Make the window as small as it allows, then set display scaling to 200%. **Pass:** every toolbar button can still be reached, and error messages can be read in full.
13. Use only the keyboard: press Tab through the screen, open the signature window, press Escape. **Pass:** you can always see where you are, and focus goes back to the button you started from.
14. Try "Share" or "Request signatures". **Pass:** either it is unavailable on desktop with an explanation, or it clearly says the link only works on this computer. It must never say an email was sent.

## v0.1.7 interaction summary
v0.1.7 merged mid-audit.
- **Fixed:** FUX-01 (desktop auto account; web local page ops).
- **Unchanged:** FUX-04, 05, 06, 07, 08, 09, 12, 13 (re-run on bc7ee6b).
- **Worsened:** FUX-02 (every desktop document now hits the missing routes); FUX-09 (more unsaved local state).
- **New:** FUX-11 and FUX-19.
- **Watch:** PR #33 (revert of sign-in removal) and release/ready (v0.2.0) may change FUX-01 and FUX-02. Re-run `packages/frontend-tests/audit` on that commit.
