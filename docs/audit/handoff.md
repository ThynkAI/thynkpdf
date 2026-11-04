# Audit handoff file (shared by Bot 1 and Bot 2)
Each bot appends or edits **only its own section**. Bot 1 = backend/desktop/security/release (branch `audit/backend-desktop`). Bot 2 = web/frontend/UX (branch `audit/frontend-ux`). If both branches add this file, merge by keeping both sections verbatim.

## Bot 1 → Bot 2 (2026-11-01, audited commit 7604fc5 = v0.1.6; release binaries v0.1.5 tested)
Full report: `docs/audit/backend-desktop-audit.md`. Evidence: `docs/audit/backend-test-results.md`, `tools/audit/`.

**Before you judge any desktop UI tool, know this:** the packaged sidecar in every release (v0.1.0 through v0.1.6) serves only **23 of 74** API routes (BD-01). These are missing on desktop:
- `/pdf/annotations*`
- `/pdf/forms/*`
- `/pdf/signatures/*`
- `/signatures/assets*`
- `/signature-requests*`
- `/sign/*`
- `/shared/*`
- `/documents/{id}/shares`
- `/folders`, `/tags`
- `/documents/{id}/restore`, `/documents/{id}/versions/{vid}/restore`
- `/audit`
- `/ai/*`
- `/pdf/pages/{delete,duplicate,insert-blank,insert-from}`

These still exist on desktop: auth, upload, list/get/versions/download, metadata, capabilities, rotate, reorder, extract, merge, split, edit (text), compress, jobs, health.
So any desktop failure in Comment / Forms / Sign / Documents / AI is expected to be a backend 404/405 until BD-01 is fixed. Please record which UI flows still work **client-side** (pdf-lib/local file mode) versus which fail, and what the user sees when they fail (silent? toast? spinner forever?).

Please verify or own these:
1. **BD-02 first run:** a fresh install has 0 users and the UI offers only "Sign in" (`SignInForm.tsx`; no register path in the shipped bundle). Screenshot: `docs/audit/evidence/v0.1.5-linux-first-launch.png`. Please walk the GUI on a fresh profile and document every point where a user is blocked. Proposed fix: a desktop bootstrap session (`POST /desktop/session` with a per-launch secret held by Electron main and exposed via preload). The UI should then skip sign-in in desktop mode. We need to agree the contract here before either of us changes `packages/editor-client` types.
2. **BD-06:** share and signer links are built from `window.location.origin` (`publicLinks.ts:5-6`). On desktop that is `http://127.0.0.1:<random port>`, which nobody else can open and which dies at the next launch. Email is never sent. Proposed: in desktop mode, hide "Create public link" and remote "Request signatures", or label them "works only on this computer while THYNKPDF is open". Keep the existing "Visual e-signature only — not a cryptographic digital signature" copy; it is good.
3. **BD-19:** the origin changes every launch, so IndexedDB saved signatures (`sigStore.ts`), `tp-author` and `tp-theme` localStorage should be lost on restart. Please confirm in the GUI.
4. **BD-12:** OCR does not exist (no endpoint, nothing packaged). Remove any UI copy that implies OCR.
5. **BD-27:** text delete is not redaction, and earlier versions keep the text. Make sure no UI says "redact" or "permanently remove".
6. **BD-09 / BD-10:** duplicate page drops annotations. Reorder, extract and merge drop bookmarks, attachments and the AcroForm (a reordered form is no longer fillable). If the UI keeps these ops before the engine is fixed, show a warning.
7. **BD-08:** moving a text run displaces the next run in the same text block. Hide or limit "move text" until it is fixed.
8. **BD-15 / BD-14:** heavy ops block the sidecar (`/health` up to about 9 s). Check that the UI shows progress and does not double-submit; there is no cancel API.
9. **BD-03:** web-e2e runs only on PRs, never on the tag commits (e6c51a4 and 7604fc5 have no web-e2e run). I recommend adding `push: tags: [v*]` and making the release job depend on it. This is a workflow change, so tell me if you would rather own it.
10. **BD-23:** please confirm `apps/web/LICENSES.md` covers the shipped web fonts and icons.

Shared files I did **not** touch: `apps/web/**`, `packages/{ui,pdf-viewer,editor-client,frontend-tests}/**`, `.github/workflows/**`, root `.gitignore`.
Files I added: `docs/audit/{backend-desktop-audit,backend-test-results,handoff}.md`, `docs/audit/evidence/`, `tools/audit/**`, `packages/backend-tests/audit/**`.

## Bot 2 → Bot 1
_(reserved for Bot 2)_
