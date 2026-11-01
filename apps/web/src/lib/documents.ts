"use client";
import { openPdf, extractAllText, sizesFromMetadata, detectXfa, type PdfSource } from "@thynkpdf/pdf-viewer/client";
import { useViewerStore, moveOrder, isIdentity } from "@thynkpdf/pdf-viewer";
import { useSession } from "./session";
import { loadPersisted, savePersisted } from "./persist";
import { useAnnot } from "./annotState";
import { ApiError, VersionConflictError, DocumentSignedError, RateLimitedError, HttpEditorApi, type DocumentRef, type VersionResult } from "@thynkpdf/editor-client";

let textJob: Promise<void> | null = null;
async function load(src: PdfSource, name: string, keepPage = false, sizes?: { width: number; height: number }[]) {
  const prev = useViewerStore.getState().doc;
  const r = await openPdf(src, sizes);
  useViewerStore.getState().setDocument(r.doc, name, r.sizes, keepPage);
  void detectXfa(r.doc).then((m) => { if (useViewerStore.getState().doc === r.doc) useViewerStore.getState().setXfa(m); });
  void prev?.destroy();
  textJob = null;
  // Text is extracted lazily (on first search) so reloads after an edit only fetch the byte ranges the visible pages need.
  if (useViewerStore.getState().query) void ensureText();
}

export function ensureText() {
  const doc = useViewerStore.getState().doc;
  if (!doc) return Promise.resolve();
  if (!textJob) textJob = extractAllText(doc).then((t) => { if (useViewerStore.getState().doc === doc) useViewerStore.getState().setPagesText(t); });
  return textJob;
}

export async function refreshCapabilities() {
  const s = useSession.getState();
  if (!s.ref) return s.set({ caps: null, capsError: null });
  const ref = s.ref;
  try {
    const caps = await s.api.getCapabilities(ref.document_id);
    if (useSession.getState().ref?.document_id === ref.document_id) s.set({ caps, capsError: null });
  } catch (e) { s.set({ caps: null, capsError: (e as Error).message }); }
}

async function openServerRef(ref: DocumentRef, name: string, keepPage: boolean) {
  const s = useSession.getState();
  s.set({ caps: null });
  // Incremental reload: page sizes come from /metadata, PDF.js range-loads only what is rendered, and the page position is kept.
  const [src, meta] = await Promise.all([s.api.fileSource(ref), s.api.getMetadata(ref.document_id, ref.version).catch(() => null)]);
  await load(src, name, keepPage, meta && meta.version === ref.version ? sizesFromMetadata(meta.pages) : undefined);
  s.set({ ref, source: s.api.kind === "mock" ? "mock" : "backend" });
  if (s.api.kind === "http") savePersisted({ lastDocumentId: ref.document_id });
  void refreshCapabilities();
}

export async function openFile(file: File) {
  useAnnot.getState().set({ working: null });
  const s = useSession.getState();
  s.set({ busy: "Opening…", error: null, notice: null });
  try {
    if (s.backend === "online" && s.authed) {
      s.set({ busy: "Uploading…" });
      const up = await s.api.upload(file, file.name);
      await openServerRef({ document_id: up.document_id, version_id: up.version_id, version: up.version }, file.name, false);
    } else {
      await loadLocalBytes(new Uint8Array(await file.arrayBuffer()), file.name);
    }
  } catch (e) {
    s.set({ error: `Could not open ${file.name}: ${(e as Error).message}` });
  } finally { s.set({ busy: null }); }
}

/** Open the current version of a server document (used for session restore and conflict recovery). */
export async function openLatest(documentId: string, keepPage = false) {
  useAnnot.getState().set({ working: null });
  const s = useSession.getState();
  const d = await s.api.getDocument(documentId);
  await openServerRef({ document_id: d.document_id, version_id: d.version_id, version: d.current_version }, d.filename, keepPage);
  return d;
}

/** Restore tokens + last server document after a page reload. */
export async function restoreSession(target?: { doc: string; version?: string; n?: number }) {
  const s = useSession.getState();
  if (s.api.kind !== "http") return;
  const p = loadPersisted();
  if (!(await bootstrapAuth())) return;
  if (target) {
    s.set({ busy: "Opening…" });
    try {
      if (target.version && target.n) await openVersionReadOnly(target.doc, target.version, target.n);
      else await openLatest(target.doc);
    } catch (e) { s.set({ error: `Could not open document: ${describeError(e)}` }); }
    finally { s.set({ busy: null }); }
    return;
  }
  if (!p.lastDocumentId) return;
  s.set({ busy: "Restoring last document…" });
  try { await openLatest(p.lastDocumentId); }
  catch (e) {
    if (!s.api.getTokens()) s.set({ notice: "Your session expired. Please sign in again." });
    else { savePersisted({ lastDocumentId: null }); s.set({ notice: `Could not reopen last document: ${(e as Error).message}` }); }
  } finally { s.set({ busy: null }); }
}

export let lastReport: Record<string, unknown> | null = null;
async function runPageOp(label: string, op: (ref: DocumentRef) => Promise<VersionResult>, refOverride?: DocumentRef | null) {
  const s = useSession.getState();
  const ref = refOverride ?? s.ref;
  if (!ref) return;
  s.set({ busy: `${label}…`, error: null, notice: null });
  try {
    const r = await op(ref);
    lastReport = r.report ?? null;
    await openServerRef({ document_id: r.document_id, version_id: r.version_id, version: r.version }, useViewerStore.getState().fileName ?? "document.pdf", true);
  } catch (e) {
    if (e instanceof DocumentSignedError) {
      s.set({ error: `${label} blocked: this version carries a digital signature, and changing it in place would invalidate the signature. Work on a copy (Organize → Extract to new PDF) or restore an unsigned version from Documents → Versions. (DOCUMENT_SIGNED)` });
      return false;
    }
    if (e instanceof VersionConflictError) {
      try {
        const d = await openLatest(ref.document_id, true);
        s.set({ error: `Conflict: this document was changed elsewhere (you had v${ref.version}, server has v${d.current_version}). Reloaded the latest version — review it and retry ${label.toLowerCase()}.` });
      } catch (e2) { s.set({ error: `Conflict, and reloading the latest version failed: ${(e2 as Error).message}` }); }
    } else { s.set({ error: `${label} failed: ${describeError(e)}` }); return false; }
  } finally { s.set({ busy: null }); }
  return !useSession.getState().error;
}

export function describeError(e: unknown) {
  if (e instanceof DocumentSignedError) return "This document is digitally signed; editing it in place would invalidate the signature (DOCUMENT_SIGNED).";
  if (e instanceof RateLimitedError) return `Rate limited — try again in ${e.retryAfter ?? "a few"} seconds (RATE_LIMITED).`;
  if (e instanceof ApiError) {
    const hint = typeof e.details?.hint === "string" ? ` (${e.details.hint})` : "";
    const v = Array.isArray(e.details?.errors) ? (e.details!.errors as { loc?: unknown[]; msg?: string }[])[0] : null;
    if (v?.msg) return `${e.code}: ${(v.loc ?? []).slice(1).join(".")} — ${v.msg}`;
    return `${e.code}: ${e.message}${hint}`;
  }
  return (e as Error).message;
}

export const rotateCurrentPage = (deg: 90 | 180 | 270 | -90 = 90) =>
  runPageOp("Rotate", (ref) => useSession.getState().api.rotatePages(ref, [useViewerStore.getState().currentPage + 1], deg));

export async function reorderPage(from: number, to: number) {
  const order = moveOrder(useViewerStore.getState().pageSizes.length, from, to);
  if (isIdentity(order)) return;
  await runPageOp("Reorder", (ref) => useSession.getState().api.reorderPages(ref, order));
  if (!useSession.getState().error) useViewerStore.getState().goToPage(to);
}

export async function signOut() {
  const s = useSession.getState();
  if (s.api instanceof HttpEditorApi) await s.api.logout(); else s.api.setTokens(null);
  savePersisted({ lastDocumentId: null });
}

/** Find/replace text on a page via backend content-stream rewrite (POST /pdf/edit). Returns number of replacements or null. */
export async function replaceText(page: number, find: string, replacement: string, occurrence: "all" | "first") {
  const ok = await runPageOp("Edit text", (ref) => useSession.getState().api.editText(ref, [{ op: "text_replace", page, find, replacement, occurrence }]));
  if (!ok) return null;
  const applied = (lastReport?.applied as { count?: number; replacements?: number }[] | undefined) ?? [];
  return applied.reduce((n, a) => n + (a.count ?? a.replacements ?? 0), 0);
}

export const rotatePages = (pages: number[], angle: 90 | 180 | 270 | -90) =>
  runPageOp("Rotate", (ref) => useSession.getState().api.rotatePages(ref, pages, angle));
export const deletePages = (pages: number[]) => runPageOp("Delete pages", (ref) => http().deletePages(ref, pages));
export const duplicatePages = (pages: number[]) => runPageOp("Duplicate pages", (ref) => http().duplicatePages(ref, pages));
export const insertBlankAfter = (afterPage: number) => runPageOp("Insert blank page", (ref) => http().insertBlank(ref, afterPage));
export const insertFromDoc = (sourceId: string, afterPage: number) => runPageOp("Insert pages", (ref) => http().insertFrom(ref, sourceId, afterPage));
/** Save client-modified bytes as a new version of the open server document. */
export const saveAsNewVersion = (bytes: Uint8Array) => runPageOp("Save new version", (ref) => http().uploadVersion(ref, bytes, useViewerStore.getState().fileName ?? "document.pdf"));
export const restoreVersionOp = (versionId: string) => runPageOp("Restore version", (ref) => http().restoreVersion(ref, versionId));
export function http(): HttpEditorApi {
  const a = useSession.getState().api;
  if (!(a instanceof HttpEditorApi)) throw new ApiError(0, "SERVER_REQUIRED", "Requires the THYNKPDF server (not available in mock/local mode).");
  return a;
}
export const reorderTo = (order: number[]) => runPageOp("Reorder", (ref) => useSession.getState().api.reorderPages(ref, order));

/** Backend ops that create NEW documents. Return the created documents; caller decides whether to open. */
export async function newDocOp<T>(label: string, fn: () => Promise<T>): Promise<T | null> {
  const s = useSession.getState();
  s.set({ busy: `${label}…`, error: null });
  try { return await fn(); }
  catch (e) { s.set({ error: `${label} failed: ${describeError(e)}` }); return null; }
  finally { s.set({ busy: null }); }
}

/** Open an older immutable version for viewing. Editing is disabled (edits always apply to the current version). */
export async function openVersionReadOnly(documentId: string, versionId: string, number: number) {
  const s = useSession.getState();
  const d = await s.api.getDocument(documentId);
  if (d.version_id === versionId) return openLatest(documentId);
  const [src, meta] = await Promise.all([s.api.fileSource({ document_id: documentId, version_id: versionId }), s.api.getMetadata(documentId, number).catch(() => null)]);
  await load(src, `${d.filename} (v${number})`, false, meta ? sizesFromMetadata(meta.pages) : undefined);
  s.set({ ref: null, caps: null, source: s.api.kind === "mock" ? "mock" : "backend", notice: `Viewing v${number} of ${d.filename} — read-only (current is v${d.current_version}).` });
  return d;
}

/** Re-establish the session after reload via the httpOnly refresh cookie. Returns true when authenticated. Concurrent calls share one refresh. */
export async function bootstrapAuth(): Promise<boolean> {
  const s = useSession.getState();
  if (s.api.kind !== "http") return true;
  if (s.api.getTokens()) return true;
  try { await s.api.refresh(); return true; } catch { return false; }
}

/** Run a versioned server op from outside documents.ts (annotations, forms, signing, page ops). */
export const runVersionedOp = runPageOp;

export async function loadLocalBytes(bytes: Uint8Array, name: string, keepPage = false) {
  const { localBytesRef } = await import("./copies");
  localBytesRef.current = bytes;
  await load({ data: bytes.slice() }, name, keepPage); // PDF.js transfers its copy to the worker
  useSession.getState().set({ ref: null, caps: null, source: "local" });
}
