"use client";
import { useViewerStore } from "@thynkpdf/pdf-viewer";
import { useSession } from "./session";
import { describeError, loadLocalBytes, runVersionedOp, http } from "./documents";

/** Bytes of the currently open document (local file bytes, or downloaded from the server version). */
export async function currentBytes(): Promise<Uint8Array> {
  const s = useSession.getState();
  if (s.ref) {
    const src = await s.api.fileSource(s.ref);
    if ("data" in src) return src.data;
    const r = await fetch(src.url, { headers: src.httpHeaders });
    if (!r.ok) throw new Error(`download failed: ${r.status}`);
    return new Uint8Array(await r.arrayBuffer());
  }
  const b = localBytesRef.current;
  if (!b) throw new Error("No document bytes available.");
  return b;
}
export const localBytesRef: { current: Uint8Array | null } = { current: null };
export const lastDownload: { url: string | null; name: string | null } = { url: null, name: null };

/**
 * Save a client-modified PDF. Server docs: saved as a NEW VERSION of the same document via POST /documents/{id}/versions
 * (expected_version; 409 VERSION_CONFLICT reloads latest, 409 DOCUMENT_SIGNED is reported distinctly). Local docs:
 * reopened in the viewer and offered as a download.
 */
export async function saveModifiedCopy(bytes: Uint8Array, suffix: string): Promise<{ kind: "server" | "local"; name: string } | null> {
  const s = useSession.getState();
  const base = (useViewerStore.getState().fileName ?? "document.pdf").replace(/ \(v\d+\)$/, "").replace(/\.pdf$/i, "");
  const name = `${base}-${suffix}.pdf`;
  s.set({ busy: "Saving…", error: null });
  try {
    if (s.ref) {
      const ref = s.ref;
      s.set({ busy: null });
      const ok = await runVersionedOp(`Save (${suffix})`, (r) => http().uploadVersion(r, bytes, useViewerStore.getState().fileName ?? name), ref);
      if (!ok) return null;
      s.set({ notice: `Saved as version ${useSession.getState().ref?.version ?? ""} of this document.` });
      return { kind: "server", name };
    }
    await loadLocalBytes(bytes, name);
    if (lastDownload.url) URL.revokeObjectURL(lastDownload.url);
    lastDownload.url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: "application/pdf" }));
    lastDownload.name = name;
    s.set({ notice: `Created “${name}” (local). Use Download to save it.` });
    return { kind: "local", name };
  } catch (e) { s.set({ error: `Save failed: ${describeError(e)}` }); return null; }
  finally { s.set({ busy: null }); }
}
