"use client";
/**
 * Rasterize any image data URL (PNG, JPEG, SVG) to a PNG Blob. The backend rejects SVG signatures (415 SVG_NOT_SUPPORTED)
 * and accepts PNG ≤ 1 MB / ≤ 4 MP, so everything is converted here. SVG loaded through <img> runs no scripts and
 * fetches no external resources, so rasterizing it is safe.
 */
export const MAX_PIXELS = 4_000_000;
export function fitPixels(w: number, h: number, max = MAX_PIXELS) {
  const k = w * h > max ? Math.sqrt(max / (w * h)) : 1;
  return { width: Math.max(1, Math.floor(w * k)), height: Math.max(1, Math.floor(h * k)) };
}
export async function toPngBlob(dataUrl: string, maxWidth = 1200): Promise<{ blob: Blob; dataUrl: string; aspect: number }> {
  const img = await new Promise<HTMLImageElement>((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error("Could not read image")); i.src = dataUrl; });
  const w0 = img.naturalWidth || 600, h0 = img.naturalHeight || 200;
  const s = Math.min(1, maxWidth / w0);
  const { width, height } = fitPixels(Math.round(w0 * s), Math.round(h0 * s));
  const c = document.createElement("canvas"); c.width = width; c.height = height;
  c.getContext("2d")!.drawImage(img, 0, 0, width, height);
  const out = c.toDataURL("image/png");
  const blob = await (await fetch(out)).blob();
  if (blob.size > 1_000_000) throw new Error("Signature image is larger than 1 MB after conversion; use a smaller image.");
  return { blob, dataUrl: out, aspect: width / height };
}
