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
import { openFile, rotateCurrentPage, reorderPage, restoreSession, duplicatePages } from "@/lib/documents";
import { undo, redo } from "@/lib/history";
import { copyAction, cutAction, pasteAction, deleteSelection, selectAllPageText, hasTextSelection } from "@/lib/editActions";
import { saveAnnotations } from "@/lib/annotActions";
import { ShortcutsDialog } from "./ShortcutsDialog";
import { SettingsDialog } from "./SettingsDialog";
import { editGate, readOnlyView } from "@/lib/gates";
import { resolveShortcut } from "@/lib/shortcuts";
import { RedactOverlay } from "./RedactOverlay";
import { RedactToolButtons } from "./RedactPanel";
import { ImageLayer } from "./ImageBox";
import { ImagesToPdfDialog } from "./ImagesToPdfDialog";
import { useRedact, markTextSelection, deleteSelectedMarks } from "@/lib/redact";
import { useImages, removeImage, openImagesAsPdf } from "@/lib/imageState";
import { OPEN_ACCEPT, isImageFile, isPdfFile } from "@/lib/images";

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
  const [dialog, setDialog] = useState<null | "help" | "settings">(null);
  const [i2p, setI2p] = useState<File[] | null>(null);
  const applyTool = useCallback((t: ToolParam) => {
    const a = toolAction(t);
    if (a.navigate) { window.location.assign(a.navigate); return; }
    if (a.dialog === "images-to-pdf") { setI2p([]); return; }
    setShowHome(false);
    useRedact.getState().set({ tool: a.redact ? (useRedact.getState().tool ?? "area") : null });
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
  const pickTool = (t: ToolParam) => { applyTool(t); if (t !== "documents" && toolAction(t).needsDoc !== false && !useViewerStore.getState().pageSizes.length) fileRef.current?.click(); };
  // Leaving the Redact tool (Done / another tool) stops drawing marks; marks themselves stay until applied or removed.
  useEffect(() => { if (activeTool !== "redact") useRedact.getState().set({ tool: null }); }, [activeTool]);
  // Panel sections render once a document is open; scroll to the requested one when it appears.
  useEffect(() => {
    if (!pendingSection) return;
    const el = document.getElementById(pendingSection);
    if (el) { el.scrollIntoView({ block: "start" }); el.setAttribute("tabindex", "-1"); el.focus(); setPendingSection(null); }
  });
  // R4 / FUX-09: warn before closing the window/tab with unsaved in-browser edits (Electron shows a confirm dialog).
  useEffect(() => {
    const h = (e: BeforeUnloadEvent) => { if (useAnnot.getState().working?.dirty || useImages.getState().items.length || useRedact.getState().marks.length) { e.preventDefault(); e.returnValue = ""; } };
    window.addEventListener("beforeunload", h); return () => window.removeEventListener("beforeunload", h);
  }, []);
  const annotOpen = useAnnot((a) => a.open);
  useEffect(() => {
    const up = () => {
      if (useAnnot.getState().open) setTimeout(() => void markupFromSelection(), 0);
      if (useRedact.getState().tool === "text") setTimeout(() => void markTextSelection(), 0);
    };
    document.addEventListener("mouseup", up); document.addEventListener("touchend", up);
    return () => { document.removeEventListener("mouseup", up); document.removeEventListener("touchend", up); };
  }, []);
  const fileName = useViewerStore((s) => s.fileName);
  const hasDoc = useViewerStore((s) => s.pageSizes.length > 0);
  const { ref, caps, capsError, busy, source } = useSession();
  useEffect(() => { if (fileName) setShowHome(false); }, [fileName]);
  // Placed (unsaved) images belong to the document they were placed on.
  useEffect(() => { const it = useImages.getState().items; if (it.length) { it.forEach((i) => URL.revokeObjectURL(i.img.url)); useImages.getState().set({ items: [], selected: null }); } }, [fileName]);
  const reorderGate = editGate("reorder", ref, caps, { busy: !!busy, capsError, readOnly: readOnlyView({ ref, source }) });

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
        case "rotate": case "rotateCcw": { const ss = useSession.getState(); if (v.pageSizes.length && editGate("rotate", ss.ref, ss.caps, { busy: !!ss.busy, capsError: ss.capsError, readOnly: readOnlyView(ss) }).enabled) void rotateCurrentPage(a === "rotate" ? 90 : -90); break; }
        case "toggleTheme": toggleTheme(); break;
        case "undo": if (!useSession.getState().busy) void undo(); break;
        case "redo": if (!useSession.getState().busy) void redo(); break;
        case "delete": void deleteSelection(); break;
        case "duplicate": if (v.pageSizes.length) void duplicatePages([v.currentPage + 1]); break;
        case "save": if (useAnnot.getState().working) void saveAnnotations(); break;
        case "print": window.print(); break;
        case "help": setDialog("help"); break;
        case "settings": setDialog("settings"); break;
        case "escape": setDialog(null); useAnnot.getState().set({ selected: [] }); useRedact.getState().set({ selected: [] }); useImages.getState().set({ selected: null }); break;
      }
    };
    // Shortcuts that must fall through to the browser in some states are filtered BEFORE preventDefault.
    const onKeyGuard = (e: KeyboardEvent) => {
      const a = resolveShortcut(e); if (!a) return;
      if (a === "copy" || a === "cut" || a === "paste") return; // handled by the native clipboard events below (also fired by the Edit menu)
      if (a === "selectAll") { if (selectAllPageText()) e.preventDefault(); return; }
      if (a === "delete") {
        if (useRedact.getState().selected.length) { e.preventDefault(); deleteSelectedMarks(); return; }
        const im = useImages.getState().selected; if (im) { e.preventDefault(); removeImage(im); return; }
        if (!useAnnot.getState().selected.length) return;
      }
      if (a === "escape") { if (useAnnot.getState().selected.length || useRedact.getState().selected.length || useImages.getState().selected || dialog) onKey(e); return; }
      onKey(e);
    };
    const editable = (t: EventTarget | null) => !!t && t instanceof HTMLElement && (/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.isContentEditable);
    // Clipboard: selected PDF text uses native copy; otherwise annotations / pages use the in-app clipboard.
    const onCopy = (e: ClipboardEvent) => { if (editable(e.target) || hasTextSelection() || !useViewerStore.getState().pageSizes.length) return; e.preventDefault(); void copyAction(); };
    const onCut = (e: ClipboardEvent) => { if (editable(e.target) || hasTextSelection() || !useViewerStore.getState().pageSizes.length) return; e.preventDefault(); void cutAction(); };
    const onPaste = (e: ClipboardEvent) => { if (editable(e.target) || !useViewerStore.getState().pageSizes.length) return; e.preventDefault(); void pasteAction(); };
    const onCustom = (e: Event) => { const t = e.type.split(":")[1]; if (t === "undo") void undo(); else if (t === "redo") void redo(); else if (t === "help") setDialog("help"); else if (t === "settings") setDialog("settings"); };
    // Clicking empty page area clears the annotation selection.
    const onDown = (e: PointerEvent) => {
      const t = e.target as Element | null; if (!t?.closest?.(".tp-page")) return;
      if (!t.closest(".tp-annot-hit") && useAnnot.getState().selected.length) useAnnot.getState().set({ selected: [] });
      if (!t.closest(".tp-redact-mark") && useRedact.getState().selected.length) useRedact.getState().set({ selected: [] });
      if (!t.closest(".tp-image-box") && useImages.getState().selected) useImages.getState().set({ selected: null });
    };
    window.addEventListener("keydown", onKeyGuard);
    document.addEventListener("copy", onCopy); document.addEventListener("cut", onCut); document.addEventListener("paste", onPaste);
    document.addEventListener("pointerdown", onDown);
    const evs = ["thynkpdf:undo", "thynkpdf:redo", "thynkpdf:help", "thynkpdf:settings"]; evs.forEach((n) => window.addEventListener(n, onCustom));
    return () => {
      window.removeEventListener("keydown", onKeyGuard);
      document.removeEventListener("copy", onCopy); document.removeEventListener("cut", onCut); document.removeEventListener("paste", onPaste);
      document.removeEventListener("pointerdown", onDown);
      evs.forEach((n) => window.removeEventListener(n, onCustom));
    };
  }, [toggleTheme, dialog]);

  /** PDFs open directly; a single image opens as a one-page PDF; several images open "Create PDF from images" to order them. */
  const onFiles = (files: FileList | null) => {
    const list = Array.from(files ?? []); if (!list.length) return;
    const pdfs = list.filter(isPdfFile), imgs = list.filter((f) => !isPdfFile(f) && isImageFile(f));
    const other = list.find((f) => !isPdfFile(f) && !isImageFile(f));
    if (other) { useSession.getState().set({ error: `${other.name} is not a PDF or a supported image (PNG, JPEG, WebP, GIF, BMP, AVIF)` }); return; }
    if (pdfs.length && imgs.length) { useSession.getState().set({ error: "Open PDFs or images, not both at once. To add images to a PDF use Add image." }); return; }
    if (imgs.length > 1) { setI2p(imgs); return; }
    if (imgs.length === 1) { void openImagesAsPdf(imgs); return; }
    if (pdfs.length > 1) useSession.getState().set({ notice: `Opened ${pdfs[0].name}. To combine PDFs use Merge & split.` });
    void openFile(pdfs[0]);
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
        <Toolbar onAnnotate={() => useAnnot.getState().set({ open: !annotOpen, tool: annotOpen ? "none" : useAnnot.getState().tool })} annotating={annotOpen} onOrganize={() => setOrganize("pages")} onOpen={() => fileRef.current?.click()} onToggleSidebar={() => setSidebar((s) => !s)} onTogglePanel={() => { setPanel((p) => (narrow ? !p : true)); setTimeout(() => searchRef.current?.focus(), 0); }} onToggleTheme={toggleTheme} dark={dark} onHelp={() => setDialog("help")} onSettings={() => setDialog("settings")} />
        {annotOpen && hasDoc && <AnnotToolbar />}
        {!annotOpen && hasDoc && !showHome && activeTool && activeTool !== "comment" && activeTool !== "documents" && activeTool !== "image-to-pdf" && (
          <ContextBar tool={activeTool} onDone={() => setActiveTool(null)}>
            {activeTool === "redact" && <><RedactToolButtons compact /><RedactCount onReview={() => { setPanel(true); setPendingSection("rd-h"); }} /></>}
          </ContextBar>)}
        <input ref={fileRef} type="file" accept={OPEN_ACCEPT} multiple hidden data-testid="file-input" onChange={(e) => { onFiles(e.target.files); e.target.value = ""; }} />
        <div className="relative flex min-h-0 flex-1">
          {sidebar && <nav aria-label="Left sidebar" className="absolute inset-y-0 left-0 z-20 w-44 shrink-0 border-r shadow-lg md:static md:shadow-none border-neutral-200 bg-neutral-50 dark:border-neutral-800 dark:bg-neutral-900"><LeftPanel onReorder={(f, t) => void reorderPage(f, t)} reorderDisabledReason={reorderGate.reason} /></nav>}
          <main className="relative min-w-0 flex-1">
            {hasDoc && !showHome && <XfaBanner />}
            <PdfViewer renderOverlay={(i, sc) => <><AnnotOverlay pageIndex={i} scale={sc} /><SignatureBox pageIndex={i} scale={sc} /><RedactOverlay pageIndex={i} scale={sc} /><ImageLayer pageIndex={i} scale={sc} /></>} />
            {(!hasDoc || showHome) && <Home onTool={pickTool} onOpen={() => { setShowHome(false); fileRef.current?.click(); }} />}
            {dragging && <div data-testid="drop-overlay" className="pointer-events-none absolute inset-2 rounded-lg border-4 border-dashed border-brand-500 bg-brand-500/10" />}
          </main>
          {panel && <RightPanel ref={searchRef} onClose={() => setPanel(false)} activeTool={activeTool} onTool={pickTool} onSettings={() => setDialog("settings")} onImagesToPdf={() => setI2p([])} />}
        </div>
        <StatusBar />
        {organize && <Organizer focus={organize} onClose={() => setOrganize(false)} />}
        {dialog === "help" && <ShortcutsDialog onClose={() => setDialog(null)} />}
        {dialog === "settings" && <SettingsDialog onClose={() => setDialog(null)} />}
        {i2p && <ImagesToPdfDialog initial={i2p} onClose={() => setI2p(null)} onCreate={(f) => { setShowHome(false); void openFile(f); }} />}
      </div>
    </TooltipProvider>
  );
}

/** Marks count + jump to the review list, shown in the Redact context bar. */
function RedactCount({ onReview }: { onReview(): void }) {
  const n = useRedact((r) => r.marks.length);
  return <button type="button" onClick={onReview} data-testid="redact-review" className="ml-2 rounded-md border border-[#E8141C] px-2 py-1 text-xs font-medium text-[#E8141C] hover:bg-[#E8141C] hover:text-white">Review &amp; apply ({n})</button>;
}
