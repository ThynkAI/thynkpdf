"use client";
import { openPdf, extractAllText, type PdfSource } from "@thynkpdf/pdf-viewer/client";
import { useViewerStore } from "@thynkpdf/pdf-viewer";
import { useSession } from "./session";
import { VersionConflictError, type DocumentRef } from "@thynkpdf/editor-client";

async function load(src: PdfSource, name: string, keepPage = false) {
  const prev = useViewerStore.getState().doc;
  const { doc, sizes } = await openPdf(src);
  useViewerStore.getState().setDocument(doc, name, sizes, keepPage);
  void prev?.destroy();
  extractAllText(doc).then((t) => { if (useViewerStore.getState().doc === doc) useViewerStore.getState().setPagesText(t); });
}

export async function openFile(file: File) {
  const s = useSession.getState();
  s.set({ busy: "Opening…", error: null });
  try {
    if (s.backend === "online" && s.authed) {
      s.set({ busy: "Uploading…" });
      const up = await s.api.upload(file, file.name);
      const ref = { document_id: up.document_id, version_id: up.version_id, version: up.version };
      await load(await s.api.fileSource(ref), file.name);
      s.set({ ref, source: s.api.kind === "mock" ? "mock" : "backend" });
    } else {
      await load({ data: new Uint8Array(await file.arrayBuffer()) }, file.name);
      s.set({ ref: null, source: "local" });
    }
  } catch (e) {
    s.set({ error: `Could not open ${file.name}: ${(e as Error).message}` });
  } finally { s.set({ busy: null }); }
}

export async function reloadVersion(ref: DocumentRef) {
  const s = useSession.getState();
  await load(await s.api.fileSource(ref), useViewerStore.getState().fileName ?? "document.pdf", true);
  s.set({ ref });
}

export async function rotateCurrentPage(deg: 90 | 180 | 270 | -90 = 90) {
  const s = useSession.getState();
  if (!s.ref) return;
  s.set({ busy: "Rotating…", error: null });
  try {
    const r = await s.api.rotatePages(s.ref, [useViewerStore.getState().currentPage + 1], deg);
    await reloadVersion({ document_id: r.document_id, version_id: r.version_id, version: r.version });
  } catch (e) {
    if (e instanceof VersionConflictError) {
      // Someone else changed the document: refetch the current version and tell the user; do not auto-retry.
      try {
        const cur = await s.api.getDocument(s.ref.document_id);
        await reloadVersion({ document_id: cur.document_id, version_id: cur.version_id, version: cur.current_version });
        s.set({ error: `Conflict: document changed on the server (now v${cur.current_version}). Reloaded latest; please retry.` });
      } catch (e2) { s.set({ error: `Conflict, and reload failed: ${(e2 as Error).message}` }); }
    } else s.set({ error: `Rotate failed: ${(e as Error).message}` });
  }
  finally { s.set({ busy: null }); }
}
