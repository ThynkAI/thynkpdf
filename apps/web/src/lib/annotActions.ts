"use client";
import { useViewerStore } from "@thynkpdf/pdf-viewer";
import { useSession } from "./session";
import { useAnnot } from "./annotState";
import { currentBytes } from "./copies";
import { loadLocalBytes, openLatest, runVersionedOp, http, describeError } from "./documents";
import { readAnnotations, buildThreads } from "./annotWrite";

export function authorName() {
  const a = useAnnot.getState().author.trim();
  return a || useSession.getState().userEmail || "Guest";
}

let seq = 0;
/** Re-read annotations from the open document. Only the latest call wins (avoids stale results from slow downloads). */
export async function refreshThreads() {
  const mine = ++seq;
  if (!useViewerStore.getState().pageSizes.length) return useAnnot.getState().set({ threads: [], all: [] });
  try {
    const all = await readAnnotations(await currentBytes());
    if (mine === seq) useAnnot.getState().set({ all, threads: buildThreads(all) });
  } catch { if (mine === seq) useAnnot.getState().set({ all: [], threads: [] }); }
}

/** Apply an in-browser edit to a working copy; the viewer reloads it in place (unsaved until Save). */
export async function applyEdit(label: string, fn: (b: Uint8Array) => Promise<Uint8Array>) {
  const s = useSession.getState(); const a = useAnnot.getState();
  s.set({ busy: `${label}…`, error: null });
  try {
    const before = await currentBytes();
    const out = await fn(before);
    const name = useViewerStore.getState().fileName ?? "document.pdf";
    const working = a.working ?? { originRef: s.ref, baseName: name.replace(/ \(v\d+\)$/, ""), original: before, dirty: true };
    await loadLocalBytes(out, working.baseName, true);
    useAnnot.getState().set({ working: { ...working, dirty: true } });
    await refreshThreads();
    return true;
  } catch (e) { s.set({ error: `${label} failed: ${describeError(e)}` }); return false; }
  finally { s.set({ busy: null }); }
}

function makeDownload(bytes: Uint8Array, name: string) {
  const a = useAnnot.getState();
  if (a.downloadUrl) URL.revokeObjectURL(a.downloadUrl);
  a.set({ downloadUrl: URL.createObjectURL(new Blob([bytes as BlobPart], { type: "application/pdf" })), downloadName: name });
}

/** Save annotations: server-origin docs become a NEW VERSION of the same document (POST /documents/{id}/versions, expected_version = the version the edits started from). */
export async function saveAnnotations() {
  const s = useSession.getState(); const w = useAnnot.getState().working;
  if (!w) return;
  const bytes = await currentBytes();
  const name = `${w.baseName.replace(/\.pdf$/i, "")}-annotated.pdf`;
  makeDownload(bytes, name);
  if (!w.originRef) { useAnnot.getState().set({ working: { ...w, dirty: false } }); s.set({ notice: `“${name}” is ready to download.` }); return; }
  const ok = await runVersionedOp("Save annotations", (r) => http().uploadVersion(r, bytes, w.baseName), w.originRef);
  if (ok) {
    useAnnot.getState().set({ working: null });
    s.set({ notice: `Annotations saved as version ${useSession.getState().ref?.version ?? ""}.` });
  } else if (useSession.getState().ref) {
    // conflict/signed: runVersionedOp reloaded the server copy, so the working copy is gone; the download link keeps the edits.
    useAnnot.getState().set({ working: null });
  }
  await refreshThreads();
}

export async function discardAnnotations() {
  const w = useAnnot.getState().working; if (!w) return;
  if (w.originRef) await openLatest(w.originRef.document_id, true);
  else if (w.original) await loadLocalBytes(w.original, w.baseName, true);
  useAnnot.getState().set({ working: null });
  await refreshThreads();
}
