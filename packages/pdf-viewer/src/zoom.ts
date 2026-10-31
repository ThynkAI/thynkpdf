export type ZoomMode = "fit-width" | "fit-page" | "custom";
export const MIN_SCALE = 0.1, MAX_SCALE = 8;
export const ZOOM_STEPS = [0.25, 0.5, 0.67, 0.75, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4, 6, 8];
export const clampScale = (s: number) => Math.min(MAX_SCALE, Math.max(MIN_SCALE, s));
export interface Size { width: number; height: number }

/** Compute CSS scale (1 = 72dpi PDF points -> CSS px). */
export function computeScale(mode: ZoomMode, custom: number, page: Size | undefined, container: Size, padding = 32): number {
  if (mode === "custom" || !page || container.width <= 0) return clampScale(custom);
  const w = (container.width - padding) / page.width;
  if (mode === "fit-width") return clampScale(w);
  const h = (container.height - padding) / page.height;
  return clampScale(Math.min(w, h));
}
export function zoomIn(s: number) { return ZOOM_STEPS.find((z) => z > s + 1e-3) ?? MAX_SCALE; }
export function zoomOut(s: number) { return [...ZOOM_STEPS].reverse().find((z) => z < s - 1e-3) ?? MIN_SCALE; }
/** Backing-store size for crisp high-DPI rendering, capped to avoid huge canvases. */
export function canvasPixelSize(cssW: number, cssH: number, dpr: number, maxPixels = 16_777_216) {
  let ratio = Math.max(1, dpr);
  if (cssW * cssH * ratio * ratio > maxPixels) ratio = Math.sqrt(maxPixels / (cssW * cssH));
  return { width: Math.floor(cssW * ratio), height: Math.floor(cssH * ratio), ratio };
}
