"use client";
import { openPdf, extractAllText, type PdfSource } from "@thynkpdf/pdf-viewer/client";
import { useViewerStore } from "@thynkpdf/pdf-viewer";
import { useSession } from "./session";
import type { DocumentRef } from "@thynkpdf/editor-client";

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
      const ref = await s.api.upload(file, file.name);
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

export async function rotateCurrentPage(deg: 90 | 270 = 90) {
  const s = useSession.getState();
  if (!s.ref) return;
  s.set({ busy: "Rotating…", error: null });
  try {
    const next = await s.api.rotatePages(s.ref, [useViewerStore.getState().currentPage], deg);
    await reloadVersion(next);
  } catch (e) { s.set({ error: `Rotate failed: ${(e as Error).message}` }); }
  finally { s.set({ busy: null }); }
}
