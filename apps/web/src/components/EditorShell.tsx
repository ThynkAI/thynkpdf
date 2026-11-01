"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { Wordmark, TooltipProvider } from "@thynkpdf/ui";
import { useViewerStore } from "@thynkpdf/pdf-viewer";
import { PdfViewer } from "@thynkpdf/pdf-viewer/client";
import { XfaBanner } from "./XfaBanner";
import { Home as HomeIcon, Wrench } from "lucide-react";
import { Home } from "./shell/Home";
import { LeftPanel } from "./shell/LeftPanel";
import { ContextBar } from "./shell/ContextBar";
import type { ToolParam } from "@/lib/tools";
import { Toolbar } from "./Toolbar";
import { Organizer } from "./Organizer";
import { SignatureBox } from "./SignatureBox";
import { AnnotToolbar } from "./AnnotToolbar";
import { AnnotOverlay, markupFromSelection } from "./AnnotOverlay";
import { useAnnot } from "@/lib/annotState";
import { parseTool, toolAction } from "@/lib/tools";
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
  const [organize, setOrganize] = useState<false | "pages" | "compress">(false);
  const [pendingSection, setPendingSection] = useState<string | null>(null);
  const [activeTool, setActiveTool] = useState<ToolParam | null>(null);
  const [showHome, setShowHome] = useState(false);
  const applyTool = useCallback((t: ToolParam) => {
    const a = toolAction(t);
    if (a.navigate) { window.location.assign(a.navigate); return; }
    setShowHome(false);
    setActiveTool(t);
    if (a.organizer) setOrganize(a.organizer);
    useAnnot.getState().set(a.annotate ? { open: true } : { open: false, tool: "none" });
    if (a.panelSection) { setPanel(true); setPendingSection(a.panelSection); }
  }, []);
  useEffect(() => {
    const t = parseTool(window.location.search); if (!t) return;
    applyTool(t);
    const q = new URLSearchParams(window.location.search); q.delete("tool");
    window.history.replaceState(null, "", window.location.pathname + (q.toString() ? `?${q}` : ""));
  }, [applyTool]);
  /** Home tiles and the tools pane: pick a tool; with no document yet, ask for one. */
  const pickTool = (t: ToolParam) => { applyTool(t); if (t !== "documents" && !useViewerStore.getState().pageSizes.length) fileRef.current?.click(); };
  // Panel sections render once a document is open; scroll to the requested one when it appears.
  useEffect(() => {
    if (!pendingSection) return;
    const el = document.getElementById(pendingSection);
    if (el) { el.scrollIntoView({ block: "start" }); el.setAttribute("tabindex", "-1"); el.focus(); setPendingSection(null); }
  });
  const annotOpen = useAnnot((a) => a.open);
  useEffect(() => {
    const up = () => { if (useAnnot.getState().open) setTimeout(() => void markupFromSelection(), 0); };
    document.addEventListener("mouseup", up); document.addEventListener("touchend", up);
    return () => { document.removeEventListener("mouseup", up); document.removeEventListener("touchend", up); };
  }, []);
  const fileName = useViewerStore((s) => s.fileName);
  const hasDoc = useViewerStore((s) => s.pageSizes.length > 0);
  const { ref, caps, capsError, busy } = useSession();
  useEffect(() => { if (fileName) setShowHome(false); }, [fileName]);
  const reorderGate = editGate("reorder", ref, caps, { busy: !!busy, capsError });

  useEffect(() => {
    const { api, set } = useSession.getState();
    api.health().then((ok) => { set({ backend: ok ? "online" : "offline" }); if (!ok) return;
      const q = new URLSearchParams(window.location.search);
      const doc = q.get("doc");
      void restoreSession(doc ? { doc, version: q.get("version") ?? undefined, n: q.get("n") ? Number(q.get("n")) : undefined } : undefined);
      if (doc) { const keep = new URLSearchParams(window.location.search).get("tool"); window.history.replaceState(null, "", keep ? `/?tool=${encodeURIComponent(keep)}` : "/"); }
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
        <header className="flex h-11 items-center gap-1 border-b border-neutral-200 bg-white px-3 dark:border-neutral-800 dark:bg-ink">
          <Wordmark />
          <nav aria-label="Main" className="ml-3 flex items-center gap-1 text-sm">
            <button onClick={() => setShowHome(true)} aria-current={showHome || !hasDoc ? "page" : undefined} className="inline-flex items-center gap-1 rounded px-2 py-1 hover:bg-neutral-100 aria-[current=page]:bg-brand-500/10 aria-[current=page]:text-brand-700 dark:hover:bg-neutral-800 dark:aria-[current=page]:text-brand-300"><HomeIcon aria-hidden className="h-4 w-4" />Home</button>
            <button onClick={() => { setShowHome(false); setPanel(true); setPendingSection("tools-h"); }} className="inline-flex items-center gap-1 rounded px-2 py-1 hover:bg-neutral-100 dark:hover:bg-neutral-800"><Wrench aria-hidden className="h-4 w-4" />Tools</button>
            <a href="/documents" className="rounded px-2 py-1 hover:bg-neutral-100 dark:hover:bg-neutral-800">Documents</a>
          </nav>
          <span className="truncate text-sm text-neutral-500" data-testid="doc-title">{fileName ?? ""}</span>
        </header>
        <Toolbar onAnnotate={() => useAnnot.getState().set({ open: !annotOpen, tool: annotOpen ? "none" : useAnnot.getState().tool })} annotating={annotOpen} onOrganize={() => setOrganize("pages")} onOpen={() => fileRef.current?.click()} onToggleSidebar={() => setSidebar((s) => !s)} onTogglePanel={() => { setPanel((p) => (narrow ? !p : true)); setTimeout(() => searchRef.current?.focus(), 0); }} onToggleTheme={toggleTheme} dark={dark} />
        {annotOpen && hasDoc && <AnnotToolbar />}
        {!annotOpen && hasDoc && !showHome && activeTool && activeTool !== "comment" && activeTool !== "documents" && <ContextBar tool={activeTool} onDone={() => setActiveTool(null)} />}
        <input ref={fileRef} type="file" accept="application/pdf,.pdf" hidden data-testid="file-input" onChange={(e) => { onFiles(e.target.files); e.target.value = ""; }} />
        <div className="relative flex min-h-0 flex-1">
          {sidebar && <nav aria-label="Left sidebar" className="absolute inset-y-0 left-0 z-20 w-44 shrink-0 border-r shadow-lg md:static md:shadow-none border-neutral-200 bg-neutral-50 dark:border-neutral-800 dark:bg-neutral-900"><LeftPanel onReorder={(f, t) => void reorderPage(f, t)} reorderDisabledReason={reorderGate.reason} /></nav>}
          <main className="relative min-w-0 flex-1">
            {hasDoc && !showHome && <XfaBanner />}
            <PdfViewer renderOverlay={(i, sc) => <><AnnotOverlay pageIndex={i} scale={sc} /><SignatureBox pageIndex={i} scale={sc} /></>} />
            {(!hasDoc || showHome) && <Home onTool={pickTool} onOpen={() => { setShowHome(false); fileRef.current?.click(); }} />}
            {dragging && <div data-testid="drop-overlay" className="pointer-events-none absolute inset-2 rounded-lg border-4 border-dashed border-brand-500 bg-brand-500/10" />}
          </main>
          {panel && <RightPanel ref={searchRef} onClose={() => setPanel(false)} activeTool={activeTool} onTool={pickTool} />}
        </div>
        <StatusBar />
        {organize && <Organizer focus={organize} onClose={() => setOrganize(false)} />}
      </div>
    </TooltipProvider>
  );
}
