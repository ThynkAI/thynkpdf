# User journey and workflow matrix results (Bot 2)

Run on 2026-11-01 between 00:08 and 01:10 EDT. Commits: 7604fc5 (v0.1.6) and bc7ee6b (v0.1.7).

The environment is described in `frontend-ux-audit.md` §1. Backend was a **real** local FastAPI server with a fresh DB, or the real packaged sidecar. Nothing in this file comes from a mock.

Legend:
- ✅ verified (the output was checked independently where possible)
- ❌ confirmed defect
- ⚠️ partial
- ⛔ blocked/unverified (reason given)
- E2E = an existing repo Playwright test, run by me against the real backend (61/61 pass at 7604fc5)

## Stage 2: fresh-user journey

| Step | v0.1.6 desktop AppImage (fresh profile) | v0.1.7 desktop AppImage (fresh profile) | Web (bc7ee6b), signed out |
|---|---|---|---|
| Launch | ✅ Home "What would you like to do?" visible in 385 ms | ✅ Status reads "Local engine… no sign-in needed" | ✅ |
| Obvious how to begin | ✅ Big "Open PDF" drop zone plus 8 tiles | ✅ | ✅ |
| Sign-in required? | ❌ Yes for every server tool, and there is no way to create an account (0 users in DB) (FUX-01) | ✅ No. A local account is auto-provisioned | ✅ Local pdf-lib page ops work. Sign-in is optional ("Cloud sync") |
| Choose tool, open PDF | ⚠️ Opens locally. Page tools disabled with the message "sign in, then open" | ✅ Uploads to the local engine | ✅ Local |
| Complete task | ❌ Organize, text edit, forms (server), compress: unavailable | ❌ Forms show a raw `HTTP_404` and no fields. Request signatures `HTTP_405`. AI `HTTP_405` (FUX-02). Rotate/merge/split/compress/text edit are present in the sidecar route list; desktop UI ops were not exercised one by one ⛔ | ✅ Rotate, then Save, produces a correct download (pypdf: /Rotate 90, 5 fields kept). ⚠️ Save button is hidden until Annotate is opened (FUX-11) |
| Save/export | ⚠️ Local visual signature and annotations download (E2E) | ⛔ Not run in the AppImage. Electron download dialogs can't be driven over CDP here | ✅ Download is named `<name>-annotated.pdf` |
| Original vs exported copy distinguishable | ✅ Suffix differs, and the original file is never overwritten (browser download) | Server versions: v1 is kept, each op makes vN ✅ | ✅ Suffix differs, but "-annotated" is misleading for a rotate |
| Close then reopen | ❌ Last document is not reopened, saved signatures and theme are lost (port changes) (FUX-10) | Same design. Port also changed on relaunch ⛔ (signature loss not re-run on 0.1.7) | Web reload restores session and last document (E2E at 7604fc5) |
| Missing backend | Web with backend offline: shows "Offline — files open and edit locally" (source). Killing the backend mid-session gave "Rotate failed: Failed to fetch", no false success, but the status bar still said "Connected" (FUX-17) | — | — |
| Pending-auth race | ⚠️ Opened a file while signed out, then signed in: the open document stayed "local only" until re-opened. State was consistent but confusing (no prompt to save it to the library) | n/a | n/a |

## Stage 3: workflow matrix A–I

### A. Reading
| Case | Result |
|---|---|
| Picker | ✅ Every fixture opened |
| Drag/drop | ✅ E2E "drag and drop opens a PDF" (chromium + firefox) |
| Search and navigate | ✅ 320 pages, "needle-unique-word": 1 of 1 found in about 0.4 s, jumps to p.250 |
| Zoom, fit width/page | ✅ E2E. Status zoom reads correctly |
| Thumbnails | ✅ |
| Rotated/mixed sizes | ✅ Rendered (`desktop-03`), landscape thumbnail correct. ⛔ Pixel comparison of the rotation was not done |
| Large document | ✅ See perf (§6 in the audit) |
| Keyboard | ✅ Shortcuts (E2E). Tab order is logical |
| Unsupported input | ✅ A non-PDF shows "Could not open X: Invalid PDF structure." ❌ The message is clipped in the status bar (FUX-07) |
| Cancel the picker | ⛔ A native dialog can't be driven headless. In source, the input is unchanged and no state changes |

### B. Page organization
| Case | Result |
|---|---|
| Rotate | ✅ Server: E2E persists. Local (v0.1.7): verified with pypdf |
| Reorder | ✅ E2E: drag and keyboard reorder persist |
| Duplicate, insert blank, delete (with confirmation) | ✅ E2E as new versions |
| Merge, split, extract | ✅ E2E |
| Fields and annotations after an op | ⚠️ Local rotate keeps fields (verified). Bot 1 BD-09/10: duplicate drops annotations, reorder/extract/merge drop the AcroForm. Not re-verified in the UI here ⛔ |
| Original preserved | ✅ Versions, v1 kept |
| Unsupported input | ⛔ Not tested (encrypted PDF) |

### C. Editing
| Case | Result |
|---|---|
| Simple replace | ✅ Server. pdftotext confirms "slow red cat" |
| Longer replacement | ❌ Overflows the page while reporting success (FUX-05) |
| Multi-run text | ⚠️ Correctly refused, but shows the raw `TEXT_NOT_FOUND` code (FUX-06) |
| Unicode or other scripts | ⚠️ Correctly refused, raw `EDIT_UNSUPPORTED_CHARACTERS` |
| Offline (v0.1.7) | "not available for this offline copy" ✅ honest |
| Move/insert/delete text | ⛔ Not exercised. Bot 1 reports BD-08: moving a run displaces the next run |

### D. Annotations
| Case | Result |
|---|---|
| All tools, threads, resolve, eraser, save, verify with PDF.js + qpdf | ✅ E2E slice7, real backend, 7604fc5 |
| Signature on a rotated page | ✅ E2E |
| Unicode comment font | ✅ E2E |
| Undo/redo (v0.1.7) | ⛔ Unit tests only (history.test.ts passes). Not driven in the UI |
| Another reader | ✅ E2E uses qpdf/PDF.js. ⛔ Not opened in Acrobat or Preview |
| Coordinates under zoom/rotation | ⚠️ Rotation covered by E2E. ⛔ Zoom matrix not run |

### E. Forms
| Case | Result |
|---|---|
| Text, radio, dropdown, multiline fill (server) | ✅ pypdf reads back `name=Jane Q Tester, color=/blue, country=Mexico, notes=line1 line2`. Rendered output checked |
| Checkbox | ⛔ My click was intercepted by the Organizer overlay (O-1). E2E covers fill and flatten |
| Multiline field | ⚠️ Single-line input, so newlines can't be entered (FUX-16) |
| XFA | ✅ E2E: dynamic XFA renders and saves. Hybrid documents get an honest banner |
| Desktop | ❌ v0.1.7: forms 404 (FUX-02) |
| Keyboard-only | ✅ All controls are labelled native inputs. ⛔ Full keyboard pass not timed |

### F. Signing
| Case | Result |
|---|---|
| Draw, place, resize, apply locally, download contains stamp | ✅ E2E |
| Type signature | ✅ (desk6 probe) |
| Upload signature | ⛔ Not run |
| Server placement | ✅ E2E |
| Certificate vs visual | ✅ Copy says "Visual e-signature only — not a cryptographic digital signature" |
| Remote request on desktop | ❌ 405 (FUX-02). The links would be loopback (FUX-03) |
| False "email sent" | ✅ None. Says "No email is sent" |
| Saved signatures across restart | ❌ Lost (FUX-10) |

### G. Compression
| Case | Result |
|---|---|
| Real reduction | ✅ 1341 B → 957 B |
| Display | ❌ Shows "1 KB → 1 KB" (FUX-08) |
| No-reduction message | ⛔ Could not produce a non-shrinking file in time |
| Cancel | ⛔ There is no cancel API (Bot 1) |

### H. Document management
| Case | Result |
|---|---|
| Upload, search, open, edit, old version read-only, restore | ✅ E2E slice4 (web) |
| Star, tag, folder, share link, trash, restore, delete forever (with confirmation) | ✅ E2E slice4 (web) |
| 409 conflict | ✅ E2E. Reloads the latest version |
| Desktop | ❌ Folders, tags, restore and shares are missing from the sidecar (BD-01). The v0.1.7 dashboard renders a list, but those actions would 404 ⛔ (not clicked) |
| Stale state on document switch | ✅ Version and caps are keyed per document (gates.ts). No stale state seen while switching between 5 documents |

### I. AI
| Case | Result |
|---|---|
| Default provider | ✅ Extractive (keyword excerpts) |
| Labels | ❌ Entry points say "Ask AI", the panel says excerpt (FUX-04) |
| Citations | ✅ p.250 is exact and clickable |
| Scanned document | ✅ Honest message, with a raw code |
| Consent | v0.1.7 BYO AI: "Connect your own AI" is in Settings. ⛔ Consent text not exercised (no key). `consent-text` was not present in my web run |
| Desktop | ❌ 405 |

## Stage 7: save safety
| Case | Result |
|---|---|
| Reload/close with unsaved local edits | ❌ No prompt (FUX-09) |
| Backend killed during save | ✅ No false success, version unchanged. ❌ Wording, plus a stale "Connected" (FUX-17) |
| Double click during failure, then retry | ✅ Exactly one new version after recovery |
| Version conflict | ✅ E2E 409 |
| Interrupted upload, switching documents mid-operation, disk-write failure, crash recovery | ⛔ Not run. Disk-write failure was handed to Bot 1 |
| Diagnostics leaking text | ⛔ Not inspected. The desktop `server.log` contained only the READY line in my runs |

## 5. Raw desktop v0.1.7 probe output (`audit/probes/d17.mjs`)
```
status:  Local engine on this computer — works offline, no sign-in needed
footer:  Page 1 of 1 / 126% (fit width) / Source: backend
alert:   HTTP_404: GET /pdf/<id>/forms?version=1 failed: 404
request: HTTP_405: POST /signature-requests failed: 405   (list stuck on "Loading…")
ai:      HTTP_405: POST /ai/ask failed: 405
sidecar openapi routes: 23
```
