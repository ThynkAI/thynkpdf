"use client";
import { useViewerStore } from "@thynkpdf/pdf-viewer";
import type { PageGeom } from "./geometry";
const cache = new WeakMap<object, Map<number, PageGeom>>();
export async function getGeom(pageIndex: number): Promise<PageGeom | null> {
  const doc = useViewerStore.getState().doc; if (!doc) return null;
  let m = cache.get(doc); if (!m) { m = new Map(); cache.set(doc, m); }
  const hit = m.get(pageIndex); if (hit) return hit;
  const p = await doc.getPage(pageIndex + 1);
  const [x0, y0, x1, y1] = p.view;
  const g = { width: x1 - x0, height: y1 - y0, rotation: p.rotate, x0, y0 };
  m.set(pageIndex, g); return g;
}
