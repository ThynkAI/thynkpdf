"use client";
import { useState, useEffect } from "react";
import { IconButton } from "@thynkpdf/ui";
import { useViewerStore } from "@thynkpdf/pdf-viewer";
import { useSession } from "@/lib/session";
import { rotateCurrentPage } from "@/lib/documents";

export function Toolbar({ onOpen, onToggleSidebar, onTogglePanel, onToggleTheme, dark }: { onOpen(): void; onToggleSidebar(): void; onTogglePanel(): void; onToggleTheme(): void; dark: boolean }) {
  const v = useViewerStore();
  const ref = useSession((s) => s.ref);
  const n = v.pageSizes.length;
  const [pageInput, setPageInput] = useState("1");
  useEffect(() => setPageInput(String(v.currentPage + 1)), [v.currentPage]);
  const has = n > 0;
  return (
    <div role="toolbar" aria-label="Document toolbar" className="flex h-11 items-center gap-1 border-b border-neutral-200 bg-neutral-50 px-2 dark:border-neutral-800 dark:bg-neutral-900">
      <IconButton label="Toggle thumbnails" onClick={onToggleSidebar}>☰</IconButton>
      <IconButton label="Open PDF" shortcut="Ctrl+O" onClick={onOpen}>Open</IconButton>
      <div className="mx-2 h-5 w-px bg-neutral-300 dark:bg-neutral-700" />
      <IconButton label="Previous page" shortcut="K" disabled={!has || v.currentPage === 0} onClick={() => v.goToPage(v.currentPage - 1)}>‹</IconButton>
      <form onSubmit={(e) => { e.preventDefault(); const p = parseInt(pageInput, 10); if (!isNaN(p)) v.goToPage(p - 1); }} className="flex items-center gap-1 text-sm">
        <input aria-label="Page number" className="w-12 rounded border border-neutral-300 bg-white px-1 py-0.5 text-center dark:border-neutral-700 dark:bg-neutral-800" value={pageInput} disabled={!has} onChange={(e) => setPageInput(e.target.value)} />
        <span className="text-neutral-500">/ {n}</span>
      </form>
      <IconButton label="Next page" shortcut="J" disabled={!has || v.currentPage >= n - 1} onClick={() => v.goToPage(v.currentPage + 1)}>›</IconButton>
      <div className="mx-2 h-5 w-px bg-neutral-300 dark:bg-neutral-700" />
      <IconButton label="Zoom out" shortcut="Ctrl+-" disabled={!has} onClick={v.zoomOut}>−</IconButton>
      <select aria-label="Zoom" disabled={!has} className="rounded border border-neutral-300 bg-white px-1 py-0.5 text-sm dark:border-neutral-700 dark:bg-neutral-800"
        value={v.zoomMode === "custom" ? "custom" : v.zoomMode}
        onChange={(e) => { const val = e.target.value; if (val === "fit-width" || val === "fit-page") v.setZoomMode(val); else if (val !== "custom") v.setCustomScale(parseFloat(val)); }}>
        <option value="fit-width">Fit width</option>
        <option value="fit-page">Fit page</option>
        <option value="custom">{Math.round(v.effectiveScale * 100)}%</option>
        {[0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4].map((z) => <option key={z} value={z}>{z * 100}%</option>)}
      </select>
      <IconButton label="Zoom in" shortcut="Ctrl+=" disabled={!has} onClick={v.zoomIn}>+</IconButton>
      <div className="mx-2 h-5 w-px bg-neutral-300 dark:bg-neutral-700" />
      <IconButton label={ref ? "Rotate page clockwise" : "Rotate page (requires backend document)"} shortcut="Ctrl+Shift+R" disabled={!has || !ref} onClick={() => rotateCurrentPage(90)}>⟳</IconButton>
      <div className="ml-auto flex items-center gap-1">
        <IconButton label="Search" shortcut="Ctrl+F" onClick={onTogglePanel}>⌕</IconButton>
        <IconButton label={dark ? "Switch to light theme" : "Switch to dark theme"} onClick={onToggleTheme}>{dark ? "☀" : "☾"}</IconButton>
      </div>
    </div>
  );
}
