"use client";
import { create } from "zustand";
/** In-memory only: signature images are never persisted or uploaded except when stamped into a PDF the user saves. */
export interface Placement { page: number; left: number; top: number; width: number; height: number } // PDF points, top-left origin
export interface SigState {
  image: { dataUrl: string; mime: "image/png" | "image/jpeg"; aspect: number } | null;
  placement: Placement | null;
  set(p: Partial<SigState>): void;
}
export const useSignature = create<SigState>((set) => ({ image: null, placement: null, set: (p) => set(p) }));

export function dataUrlToBytes(u: string): Uint8Array {
  const b = atob(u.slice(u.indexOf(",") + 1));
  return Uint8Array.from(b, (c) => c.charCodeAt(0));
}
/** Render typed name to a transparent PNG. Uses generic cursive/serif system fonts (no bundled third-party font). */
export function typedSignature(text: string, style: "cursive" | "serif-italic"): { dataUrl: string; aspect: number } {
  const c = document.createElement("canvas"); const ctx = c.getContext("2d")!;
  const font = style === "cursive" ? "64px cursive" : "italic 64px Georgia, serif";
  ctx.font = font; const w = Math.ceil(ctx.measureText(text).width) + 24;
  c.width = Math.max(w, 40); c.height = 96;
  ctx.font = font; ctx.fillStyle = "#111827"; ctx.textBaseline = "middle"; ctx.fillText(text, 12, 50);
  return { dataUrl: c.toDataURL("image/png"), aspect: c.width / c.height };
}
