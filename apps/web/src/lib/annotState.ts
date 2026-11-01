"use client";
import { create } from "zustand";
import type { DocumentRef } from "@thynkpdf/editor-client";
import type { Thread, ParsedAnnot } from "./annotWrite";

export type Tool = "none" | "highlight" | "underline" | "strikeout" | "ink" | "eraser" | "note" | "freetext" | "callout" | "square" | "circle" | "line" | "arrow" | "stamp";
export const MARKUP: Tool[] = ["highlight", "underline", "strikeout"];
export const STAMPS = ["APPROVED", "REVIEWED", "DRAFT", "CONFIDENTIAL", "FINAL", "REJECTED"];
export const COLORS: { name: string; rgb: [number, number, number] }[] = [
  { name: "Yellow", rgb: [1, 0.85, 0] }, { name: "Green", rgb: [0.2, 0.75, 0.3] }, { name: "Blue", rgb: [0.15, 0.45, 0.95] },
  { name: "Red", rgb: [0.9, 0.15, 0.15] }, { name: "Purple", rgb: [0.55, 0.3, 0.85] }, { name: "Black", rgb: [0.1, 0.1, 0.1] },
];
export interface Working { originRef: DocumentRef | null; baseName: string; original: Uint8Array | null; dirty: boolean }
export interface AnnotState {
  open: boolean; tool: Tool; color: [number, number, number]; stamp: string; text: string; author: string;
  working: Working | null; threads: Thread[]; all: ParsedAnnot[]; downloadUrl: string | null; downloadName: string | null;
  /** Ids of annotations selected with the Select tool (click / Shift-click). */
  selected: string[];
  set(p: Partial<AnnotState>): void;
}
const savedAuthor = () => { try { return localStorage.getItem("tp-author") ?? ""; } catch { return ""; } };
export const useAnnot = create<AnnotState>((set) => ({
  open: false, tool: "none", color: COLORS[0].rgb, stamp: STAMPS[0], text: "", author: savedAuthor(),
  working: null, threads: [], all: [], downloadUrl: null, downloadName: null, selected: [], set: (p) => set(p),
}));
