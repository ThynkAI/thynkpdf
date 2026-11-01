"use client";
import { useViewerStore } from "@thynkpdf/pdf-viewer";
import { useSession } from "./session";
import { useAnnot } from "./annotState";
import { currentBytes } from "./copies";
import { loadLocalBytes, openLatest, runVersionedOp, http, describeError } from "./documents";
import { readAnnotations, buildThreads, addAnnotations, addReply, setReviewState, deleteAnnotation, type NewAnnot, type Thread } from "./annotWrite";
import { serverCanWrite, toServer, fromServer, serverThreads } from "./annotServer";
import { getGeom } from "./pageGeom";
import { record } from "./history";
import { getClip, setClip, nextPasteOffset, pasteAnnotations } from "./clipboard";

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
    const ref = serverMode();
    if (ref) {
      const all = fromServer((await http().listAnnotations(ref.document_id, ref.version)).annotations);
      if (mine === seq) useAnnot.getState().set({ all, threads: serverThreads(all) });
      return;
    }
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
    const restore = (b: Uint8Array) => async () => {
      await loadLocalBytes(b, working.baseName, true);
      useAnnot.getState().set({ working: { ...working, dirty: true }, selected: [] });
      await refreshThreads();
    };
    record({ label, undo: restore(before), redo: restore(out) });
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

/**
 * Server mode: the open document is a server document (no unsaved local working copy) and capabilities allow annotations.
 * Every change is then a versioned server write (expected_version; 409 handled by runVersionedOp).
 */
export function serverMode() {
  const s = useSession.getState();
  if (s.api.kind !== "http" || !s.ref || useAnnot.getState().working) return null;
  if (s.caps && s.caps.document_id === s.ref.document_id && s.caps.annotations === false) return null;
  return s.ref;
}

async function serverChange(label: string, ch: Parameters<ReturnType<typeof http>["changeAnnotations"]>[1]) {
  const ok = await runVersionedOp(label, (r) => http().changeAnnotations(r, ch));
  await refreshThreads();
  return !!ok;
}

/** Add annotations: server write when possible; otherwise (Unicode text, callouts, text on rotated pages) written in the browser. */
export async function annotate(list: NewAnnot[]) {
  if (serverMode()) {
    const rots = await Promise.all(list.map(async (a) => (await getGeom(a.page))?.rotation ?? 0));
    if (list.every((a, i) => serverCanWrite(a, rots[i]))) return serverChange("Annotate", { add: list.map(toServer) });
    // Browser-written, saved straight away as a new version so the document stays versioned on the server.
    const bytes = (await addAnnotations(await currentBytes(), list)).bytes;
    const ok = await runVersionedOp("Annotate", (r) => http().uploadVersion(r, bytes, useViewerStore.getState().fileName ?? "document.pdf"));
    await refreshThreads();
    return !!ok;
  }
  return applyEdit("Annotate", async (b) => (await addAnnotations(b, list)).bytes);
}
export async function eraseAnnotation(id: string) {
  if (serverMode()) return serverChange("Delete annotation", { delete: [id] });
  return applyEdit("Erase", (b) => deleteAnnotation(b, id));
}
/** Delete several annotations (and their replies) as ONE undoable step. */
export async function eraseAnnotations(ids: string[]) {
  if (!ids.length) return false;
  const all = useAnnot.getState().all;
  const withReplies = [...new Set([...ids, ...all.filter((a) => a.inReplyTo && ids.includes(a.inReplyTo)).map((a) => a.id)])];
  useAnnot.getState().set({ selected: [] });
  const label = ids.length > 1 ? `Delete ${ids.length} annotations` : "Delete annotation";
  if (serverMode()) return serverChange(label, { delete: withReplies });
  return applyEdit(label, async (b) => { for (const id of withReplies) b = await deleteAnnotation(b, id); return b; });
}

/** Copy the selected annotations to the in-app clipboard. Returns how many were copied. */
export async function copySelectedAnnotations() {
  const { selected, all } = useAnnot.getState();
  const picked = all.filter((a) => selected.includes(a.id));
  if (!picked.length) return 0;
  setClip({ kind: "annots", source: (await currentBytes()).slice(), ids: picked.map((a) => a.id), fromPage: picked[0].page });
  return picked.length;
}
export async function cutSelectedAnnotations() {
  const ids = useAnnot.getState().selected;
  const n = await copySelectedAnnotations();
  if (n) await eraseAnnotations(ids);
  return n;
}
/** Paste clipboard annotations onto the current page (slightly offset). Server documents get a new version. */
export async function pasteAnnotationsHere() {
  const c = getClip(); if (!c || c.kind !== "annots") return false;
  const page = useViewerStore.getState().currentPage;
  const off = nextPasteOffset(page === c.fromPage);
  let ids: string[] = [];
  const fn = async (b: Uint8Array) => { const r = await pasteAnnotations(b, c.source, c.ids, page, off); ids = r.ids; return r.bytes; };
  let ok: boolean;
  if (serverMode()) {
    const bytes = await fn(await currentBytes());
    ok = !!(await runVersionedOp("Paste annotations", (r) => http().uploadVersion(r, bytes, useViewerStore.getState().fileName ?? "document.pdf")));
    await refreshThreads();
  } else ok = await applyEdit("Paste annotations", fn);
  if (ok) useAnnot.getState().set({ selected: ids });
  return ok;
}

export async function replyTo(t: Thread, text: string) {
  if (serverMode()) {
    const r = t.root.rect;
    return serverChange("Reply", { add: [{ page: t.root.page + 1, type: "text", in_reply_to: t.root.id, contents: text, author: authorName(), rect: [r.x, r.y, r.x + 20, r.y + 20] }] });
  }
  return applyEdit("Reply", async (b) => (await addReply(b, t.root.id, authorName(), text)).bytes);
}
export async function setResolved(t: Thread, resolved: boolean) {
  if (serverMode()) return serverChange(resolved ? "Resolve" : "Reopen", { update: [{ id: t.root.id, state: resolved ? "resolved" : "open" }] });
  return applyEdit(resolved ? "Resolve" : "Reopen", async (b) => (await setReviewState(b, t.root.id, authorName(), resolved)).bytes);
}
