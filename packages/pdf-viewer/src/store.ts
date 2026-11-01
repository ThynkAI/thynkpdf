import { create } from "zustand";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { clampScale, zoomIn, zoomOut, type ZoomMode, type Size } from "./zoom";
import { findMatches, type SearchMatch } from "./search";
import type { XfaMode } from "./xfa";

export interface ViewerState {
  doc: PDFDocumentProxy | null;
  docKey: number;
  fileName: string | null;
  pageSizes: Size[];
  pagesText: (string | null)[];
  currentPage: number; // 0-based
  scrollRequest: { page: number; nonce: number } | null;
  zoomMode: ZoomMode;
  customScale: number;
  effectiveScale: number;
  query: string;
  matches: SearchMatch[];
  activeMatch: number;
  /** XFA handling for the open document (see loader.detectXfa). */
  xfa: XfaMode;
  setXfa(m: XfaMode): void;
  setDocument(doc: PDFDocumentProxy | null, fileName: string | null, sizes: Size[], keepPage?: boolean): void;
  setCurrentPage(p: number): void;
  goToPage(p: number): void;
  setZoomMode(m: ZoomMode): void;
  setCustomScale(s: number): void;
  setEffectiveScale(s: number): void;
  zoomIn(): void;
  zoomOut(): void;
  setPagesText(t: (string | null)[]): void;
  setQuery(q: string): void;
  nextMatch(dir: 1 | -1): void;
}

export const useViewerStore = create<ViewerState>((set, get) => ({
  doc: null, docKey: 0, fileName: null, pageSizes: [], pagesText: [], currentPage: 0, scrollRequest: null,
  zoomMode: "fit-width", customScale: 1, effectiveScale: 1, query: "", matches: [], activeMatch: -1, xfa: "none",
  setXfa(m) { set({ xfa: m }); },
  setDocument(doc, fileName, sizes, keepPage = false) {
    const cur = keepPage ? Math.min(get().currentPage, Math.max(0, sizes.length - 1)) : 0;
    set((s) => ({ doc, fileName, pageSizes: sizes, pagesText: sizes.map(() => null), currentPage: cur, docKey: s.docKey + 1, xfa: "none" as XfaMode,
      matches: [], activeMatch: -1, scrollRequest: keepPage ? { page: cur, nonce: Date.now() } : null }));
  },
  setCurrentPage(p) { if (p !== get().currentPage) set({ currentPage: p }); },
  goToPage(p) {
    const n = get().pageSizes.length; if (!n) return;
    const page = Math.min(n - 1, Math.max(0, p));
    set({ currentPage: page, scrollRequest: { page, nonce: Math.random() } });
  },
  setZoomMode(m) { set({ zoomMode: m }); },
  setCustomScale(s) { set({ zoomMode: "custom", customScale: clampScale(s) }); },
  setEffectiveScale(s) { set({ effectiveScale: s }); },
  zoomIn() { get().setCustomScale(zoomIn(get().effectiveScale)); },
  zoomOut() { get().setCustomScale(zoomOut(get().effectiveScale)); },
  setPagesText(t) { set({ pagesText: t }); const q = get().query; if (q) get().setQuery(q); },
  setQuery(query) {
    const matches = findMatches(get().pagesText.map((t) => t ?? ""), query);
    set({ query, matches, activeMatch: matches.length ? 0 : -1 });
    if (matches.length) get().goToPage(matches[0].page);
  },
  nextMatch(dir) {
    const { matches, activeMatch } = get(); if (!matches.length) return;
    const i = (activeMatch + dir + matches.length) % matches.length;
    set({ activeMatch: i }); get().goToPage(matches[i].page);
  },
}));
