"use client";
import { useViewerStore } from "@thynkpdf/pdf-viewer";
import { useSession } from "./session";
import { describeError, openLatest, loadLocalBytes } from "./documents";

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
 * Save a client-modified PDF. Server docs: uploaded as a NEW document (backend has no endpoint to add a version from
 * client bytes — request R4.2/R3.2) and opened. Local docs: reopened in the viewer and offered as a download.
 */
export async function saveModifiedCopy(bytes: Uint8Array, suffix: string): Promise<{ kind: "server" | "local"; name: string } | null> {
  const s = useSession.getState();
  const base = (useViewerStore.getState().fileName ?? "document.pdf").replace(/ \(v\d+\)$/, "").replace(/\.pdf$/i, "");
  const name = `${base}-${suffix}.pdf`;
  s.set({ busy: "Saving…", error: null });
  try {
    if (s.ref) {
      const up = await s.api.upload(new Blob([bytes as BlobPart], { type: "application/pdf" }), name);
      await openLatest(up.document_id);
      s.set({ notice: `Saved as new document “${name}”.` });
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
