"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { Wordmark, TooltipProvider } from "@thynkpdf/ui";
import { useViewerStore } from "@thynkpdf/pdf-viewer";
import { PdfViewer, Thumbnails } from "@thynkpdf/pdf-viewer/client";
import { Toolbar } from "./Toolbar";
import { Organizer } from "./Organizer";
import { SignatureBox } from "./SignatureBox";
import { RightPanel } from "./RightPanel";
import { StatusBar } from "./StatusBar";
import { useSession } from "@/lib/session";
import { openFile, rotateCurrentPage, reorderPage, restoreSession } from "@/lib/documents";
import { editGate } from "@/lib/gates";
import { resolveShortcut } from "@/lib/shortcuts";

export function EditorShell() {
  const fileRef = useRef<HTMLInputElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const [narrow] = useState(() => typeof window !== "undefined" && window.matchMedia("(max-width: 767px)").matches);
  const [sidebar, setSidebar] = useState(!narrow);
  const [panel, setPanel] = useState(() => typeof window === "undefined" || window.matchMedia("(min-width: 1024px)").matches);
  const [dark, setDark] = useState(() => typeof document !== "undefined" && document.documentElement.classList.contains("dark"));
  const [dragging, setDragging] = useState(false);
  const [organize, setOrganize] = useState(false);
  const fileName = useViewerStore((s) => s.fileName);
  const hasDoc = useViewerStore((s) => s.pageSizes.length > 0);
  const { ref, caps, capsError, busy } = useSession();
  const reorderGate = editGate("reorder", ref, caps, { busy: !!busy, capsError });

  useEffect(() => {
    const { api, set } = useSession.getState();
    api.health().then((ok) => { set({ backend: ok ? "online" : "offline" }); if (!ok) return;
      const q = new URLSearchParams(window.location.search);
      const doc = q.get("doc");
      void restoreSession(doc ? { doc, version: q.get("version") ?? undefined, n: q.get("n") ? Number(q.get("n")) : undefined } : undefined);
      if (doc) window.history.replaceState(null, "", "/");
    });
  }, []);

  const toggleTheme = useCallback(() => {
    setDark((d) => { const n = !d; document.documentElement.classList.toggle("dark", n); localStorage.setItem("tp-theme", n ? "dark" : "light"); return n; });
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const a = resolveShortcut(e); if (!a) return;
      const v = useViewerStore.getState();
      e.preventDefault();
      switch (a) {
        case "open": fileRef.current?.click(); break;
        case "find": setPanel(true); setTimeout(() => searchRef.current?.focus(), 0); break;
        case "zoomIn": v.zoomIn(); break;
        case "zoomOut": v.zoomOut(); break;
        case "fitWidth": v.setZoomMode("fit-width"); break;
        case "fitPage": v.setZoomMode("fit-page"); break;
        case "nextPage": v.goToPage(v.currentPage + 1); break;
        case "prevPage": v.goToPage(v.currentPage - 1); break;
        case "firstPage": v.goToPage(0); break;
        case "lastPage": v.goToPage(v.pageSizes.length - 1); break;
        case "rotate": { const ss = useSession.getState(); if (editGate("rotate", ss.ref, ss.caps, { busy: !!ss.busy, capsError: ss.capsError }).enabled) void rotateCurrentPage(90); break; }
        case "toggleTheme": toggleTheme(); break;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggleTheme]);

  const onFiles = (files: FileList | null) => {
    const f = files?.[0]; if (!f) return;
    if (f.type && f.type !== "application/pdf" && !f.name.toLowerCase().endsWith(".pdf")) { useSession.getState().set({ error: `${f.name} is not a PDF` }); return; }
    void openFile(f);
  };

  return (
    <TooltipProvider>
      <div className="flex h-screen flex-col"
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={(e) => { if (e.currentTarget === e.target) setDragging(false); }}
        onDrop={(e) => { e.preventDefault(); setDragging(false); onFiles(e.dataTransfer.files); }}>
        <header className="flex h-11 items-center gap-3 border-b border-neutral-200 px-3 dark:border-neutral-800">
          <Wordmark />
          <a href="/documents" className="rounded px-2 py-1 text-sm hover:bg-neutral-100 dark:hover:bg-neutral-800">Documents</a>
          <span className="truncate text-sm text-neutral-500" data-testid="doc-title">{fileName ?? ""}</span>
        </header>
        <Toolbar onOrganize={() => setOrganize(true)} onOpen={() => fileRef.current?.click()} onToggleSidebar={() => setSidebar((s) => !s)} onTogglePanel={() => { setPanel((p) => (narrow ? !p : true)); setTimeout(() => searchRef.current?.focus(), 0); }} onToggleTheme={toggleTheme} dark={dark} />
        <input ref={fileRef} type="file" accept="application/pdf,.pdf" hidden data-testid="file-input" onChange={(e) => { onFiles(e.target.files); e.target.value = ""; }} />
        <div className="relative flex min-h-0 flex-1">
          {sidebar && <nav aria-label="Left sidebar" className="absolute inset-y-0 left-0 z-20 w-40 shrink-0 border-r shadow-lg md:static md:shadow-none border-neutral-200 bg-neutral-50 dark:border-neutral-800 dark:bg-neutral-900"><Thumbnails onReorder={(f, t) => void reorderPage(f, t)} reorderDisabledReason={reorderGate.reason} /></nav>}
          <main className="relative min-w-0 flex-1">
            <PdfViewer renderOverlay={(i, sc) => <SignatureBox pageIndex={i} scale={sc} />} />
            {!hasDoc && (
              <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-3 text-neutral-800 dark:text-neutral-200">
                <Wordmark className="scale-150" />
                <p>Drop a PDF here or press <kbd>Ctrl+O</kbd></p>
                <button className="pointer-events-auto rounded bg-brand-600 px-4 py-2 text-white" onClick={() => fileRef.current?.click()}>Open PDF</button>
              </div>
            )}
            {dragging && <div data-testid="drop-overlay" className="pointer-events-none absolute inset-2 rounded-lg border-4 border-dashed border-brand-500 bg-brand-500/10" />}
          </main>
          {panel && <RightPanel ref={searchRef} onClose={() => setPanel(false)} />}
        </div>
        <StatusBar />
        {organize && <Organizer onClose={() => setOrganize(false)} />}
      </div>
    </TooltipProvider>
  );
}
