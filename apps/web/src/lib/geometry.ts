/** Page geometry in PDF terms: unrotated MediaBox size/origin plus /Rotate. Matches PDF.js PageViewport semantics. */
export interface PageGeom { width: number; height: number; rotation: number; x0?: number; y0?: number }
export type Pt = [number, number];
const norm = (r: number) => (((r % 360) + 360) % 360) as 0 | 90 | 180 | 270;

/** Display coords (CSS px at `scale`, top-left origin of the page as shown, i.e. rotated) → PDF user space. */
export function displayToPdf(x: number, y: number, g: PageGeom, scale: number): Pt {
  const u = x / scale, v = y / scale, W = g.width, H = g.height;
  let p: Pt;
  switch (norm(g.rotation)) {
    case 90: p = [v, u]; break;
    case 180: p = [W - u, v]; break;
    case 270: p = [W - v, H - u]; break;
    default: p = [u, H - v];
  }
  return [p[0] + (g.x0 ?? 0), p[1] + (g.y0 ?? 0)];
}
/** Inverse of displayToPdf. */
export function pdfToDisplay(px: number, py: number, g: PageGeom, scale: number): Pt {
  const a = px - (g.x0 ?? 0), b = py - (g.y0 ?? 0), W = g.width, H = g.height;
  let d: Pt;
  switch (norm(g.rotation)) {
    case 90: d = [b, a]; break;
    case 180: d = [W - a, b]; break;
    case 270: d = [H - b, W - a]; break;
    default: d = [a, H - b];
  }
  return [d[0] * scale, d[1] * scale];
}
export interface Rect { x: number; y: number; width: number; height: number }
/** Display box → axis-aligned PDF rect. */
export function displayBoxToPdfRect(left: number, top: number, w: number, h: number, g: PageGeom, scale: number): Rect {
  const a = displayToPdf(left, top, g, scale), b = displayToPdf(left + w, top + h, g, scale);
  return { x: Math.min(a[0], b[0]), y: Math.min(a[1], b[1]), width: Math.abs(a[0] - b[0]), height: Math.abs(a[1] - b[1]) };
}
/** Placement for an image that should look upright on a rotated page: origin = visual bottom-left, rotate CCW by page rotation. */
export function uprightImagePlacement(left: number, top: number, w: number, h: number, g: PageGeom, scale: number) {
  const [x, y] = displayToPdf(left, top + h, g, scale);
  return { x, y, width: w / scale, height: h / scale, rotate: norm(g.rotation) };
}
