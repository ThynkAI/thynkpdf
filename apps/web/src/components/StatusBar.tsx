"use client";
import { useViewerStore } from "@thynkpdf/pdf-viewer";
import { useSession } from "@/lib/session";
export function StatusBar() {
  const { currentPage, pageSizes, effectiveScale, zoomMode } = useViewerStore();
  const { source, busy, error } = useSession();
  return (
    <footer role="status" className="flex h-7 items-center gap-4 border-t border-neutral-200 bg-neutral-50 px-3 text-xs text-neutral-600 dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-400">
      <span data-testid="status-page">{pageSizes.length ? `Page ${currentPage + 1} of ${pageSizes.length}` : "No document"}</span>
      <span data-testid="status-zoom">{Math.round(effectiveScale * 100)}%{zoomMode !== "custom" ? ` (${zoomMode.replace("-", " ")})` : ""}</span>
      <span>Source: {source}</span>
      {busy && <span className="text-brand-600">{busy}</span>}
      {error && <span role="alert" className="text-red-600">{error}</span>}
    </footer>
  );
}
