"use client";
import { openPdf, extractAllText, type PdfSource } from "@thynkpdf/pdf-viewer/client";
import { useViewerStore, moveOrder, isIdentity } from "@thynkpdf/pdf-viewer";
import { useSession } from "./session";
import { loadPersisted, savePersisted } from "./persist";
import { VersionConflictError, type DocumentRef, type VersionResult } from "@thynkpdf/editor-client";

async function load(src: PdfSource, name: string, keepPage = false) {
  const prev = useViewerStore.getState().doc;
  const { doc, sizes } = await openPdf(src);
  useViewerStore.getState().setDocument(doc, name, sizes, keepPage);
  void prev?.destroy();
  extractAllText(doc).then((t) => { if (useViewerStore.getState().doc === doc) useViewerStore.getState().setPagesText(t); });
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
  await load(await s.api.fileSource(ref), name, keepPage);
  s.set({ ref, source: s.api.kind === "mock" ? "mock" : "backend" });
  if (s.api.kind === "http") savePersisted({ lastDocumentId: ref.document_id });
  void refreshCapabilities();
}

export async function openFile(file: File) {
  const s = useSession.getState();
  s.set({ busy: "Opening…", error: null, notice: null });
  try {
    if (s.backend === "online" && s.authed) {
      s.set({ busy: "Uploading…" });
      const up = await s.api.upload(file, file.name);
      await openServerRef({ document_id: up.document_id, version_id: up.version_id, version: up.version }, file.name, false);
    } else {
      await load({ data: new Uint8Array(await file.arrayBuffer()) }, file.name);
      s.set({ ref: null, caps: null, source: "local" });
    }
  } catch (e) {
    s.set({ error: `Could not open ${file.name}: ${(e as Error).message}` });
  } finally { s.set({ busy: null }); }
}

/** Open the current version of a server document (used for session restore and conflict recovery). */
export async function openLatest(documentId: string, keepPage = false) {
  const s = useSession.getState();
  const d = await s.api.getDocument(documentId);
  await openServerRef({ document_id: d.document_id, version_id: d.version_id, version: d.current_version }, d.filename, keepPage);
  return d;
}

/** Restore tokens + last server document after a page reload. */
export async function restoreSession() {
  const s = useSession.getState();
  if (s.api.kind !== "http") return;
  const p = loadPersisted();
  if (!p.tokens) return;
  s.api.setTokens(p.tokens);
  if (!p.lastDocumentId) return;
  s.set({ busy: "Restoring last document…" });
  try { await openLatest(p.lastDocumentId); }
  catch (e) {
    if (!s.api.getTokens()) s.set({ notice: "Your session expired. Please sign in again." });
    else { savePersisted({ lastDocumentId: null }); s.set({ notice: `Could not reopen last document: ${(e as Error).message}` }); }
  } finally { s.set({ busy: null }); }
}

async function runPageOp(label: string, op: (ref: DocumentRef) => Promise<VersionResult>) {
  const s = useSession.getState();
  if (!s.ref) return;
  const ref = s.ref;
  s.set({ busy: `${label}…`, error: null, notice: null });
  try {
    const r = await op(ref);
    await openServerRef({ document_id: r.document_id, version_id: r.version_id, version: r.version }, useViewerStore.getState().fileName ?? "document.pdf", true);
  } catch (e) {
    if (e instanceof VersionConflictError) {
      try {
        const d = await openLatest(ref.document_id, true);
        s.set({ error: `Conflict: this document was changed elsewhere (you had v${ref.version}, server has v${d.current_version}). Reloaded the latest version — review it and retry ${label.toLowerCase()}.` });
      } catch (e2) { s.set({ error: `Conflict, and reloading the latest version failed: ${(e2 as Error).message}` }); }
    } else s.set({ error: `${label} failed: ${(e as Error).message}` });
  } finally { s.set({ busy: null }); }
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
  s.api.setTokens(null);
  savePersisted({ lastDocumentId: null });
}
