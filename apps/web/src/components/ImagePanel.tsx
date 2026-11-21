"use client";
import { useRef, useState } from "react";
import { useViewerStore } from "@thynkpdf/pdf-viewer";
import { ImagePlus, ImageDown, Images } from "lucide-react";
import { useSession } from "@/lib/session";
import { readOnlyView } from "@/lib/gates";
import { IMAGE_ACCEPT, toEmbeddable } from "@/lib/images";
import { useImages, placeImage, applyImages, removeImage, exportPages } from "@/lib/imageState";
import { parseRanges } from "@/lib/ranges";

/** Add image (place → move/resize/rotate → save into the PDF) and Export pages as PNG/JPEG. */
export function ImagePanel({ onImagesToPdf }: { onImagesToPdf?: () => void }) {
  const { pageSizes, currentPage, goToPage } = useViewerStore();
  const s = useSession(); const { items, selected } = useImages();
  const input = useRef<HTMLInputElement>(null);
  const [fmt, setFmt] = useState<"png" | "jpeg">("png"); const [dpi, setDpi] = useState(150);
  const [range, setRange] = useState<"current" | "all" | "custom">("current"); const [custom, setCustom] = useState("");
  const [progress, setProgress] = useState<string | null>(null);
  const [dl, setDl] = useState<{ url: string; name: string } | null>(null);
  if (!pageSizes.length) return null;
  const ro = readOnlyView(s);
  const add = async (files: FileList | null) => {
    for (const f of Array.from(files ?? [])) {
      try { await placeImage(await toEmbeddable(f), currentPage); }
      catch (e) { s.set({ error: (e as Error).message }); }
    }
  };
  const doExport = async () => {
    let pages: number[] = [];
    if (range === "current") pages = [currentPage];
    else if (range === "all") pages = pageSizes.map((_, i) => i);
    else { const r = parseRanges(custom, pageSizes.length); if ("error" in r) { s.set({ error: r.error }); return; } pages = r.ranges.flatMap(([a, b]) => Array.from({ length: b - a + 1 }, (_, i) => a - 1 + i)); }
    setProgress(`0 / ${pages.length}`);
    try { const n = await exportPages(pages, fmt, dpi, (k) => setProgress(`${k} / ${pages.length}`)); s.set({ notice: `Exported ${n} page${n === 1 ? "" : "s"} as ${fmt.toUpperCase()}${(n ?? 0) > 1 ? " (zip)" : ""}.` }); }
    catch (e) { s.set({ error: `Export failed: ${(e as Error).message}` }); }
    finally { setProgress(null); }
  };
  return (
    <>
      <section aria-labelledby="img-h" data-testid="image-panel">
        <h2 id="img-h" className="mb-1 flex items-center gap-1 font-semibold"><ImagePlus aria-hidden className="h-4 w-4" />Add image</h2>
        <p className="mb-2 text-[11px] text-neutral-600 dark:text-neutral-400">PNG, JPEG, WebP, GIF, BMP or AVIF. Drag to move, corner to resize, the red knob to rotate; Delete removes. Ctrl+Z undoes.</p>
        <input ref={input} type="file" accept={IMAGE_ACCEPT} multiple hidden data-testid="image-input" onChange={(e) => { void add(e.target.files); e.target.value = ""; }} />
        <div className="flex flex-wrap gap-1 text-xs">
          <button className="inline-flex items-center gap-1 rounded bg-ink px-2 py-1 text-white disabled:opacity-40 dark:bg-neutral-700" disabled={ro || !!s.busy} onClick={() => input.current?.click()} data-testid="image-add">
            <ImagePlus aria-hidden className="h-3.5 w-3.5" />Place image on page {currentPage + 1}</button>
          <button className="rounded bg-[#E8141C] px-2 py-1 font-semibold text-white disabled:opacity-40" disabled={!items.length || !!s.busy || ro} onClick={async () => { const k = await applyImages(); if (k) { const { lastDownload } = await import("@/lib/copies"); setDl(k === "local" && lastDownload.url ? { url: lastDownload.url, name: lastDownload.name! } : null); } }} data-testid="image-apply">Save {items.length || ""} into PDF</button>
        </div>
        {dl && !items.length && <a className="mt-1 block text-xs underline" href={dl.url} download={dl.name} data-testid="download-images">Download {dl.name}</a>}
        {ro && <p className="mt-1 text-xs text-neutral-500">You are viewing an older version (read-only).</p>}
        {items.length > 0 && (
          <ul className="mt-2 space-y-0.5 text-xs" data-testid="image-list">
            {items.map((it) => (
              <li key={it.id} className={`flex items-center gap-1 rounded px-1 ${selected === it.id ? "bg-[#E8141C]/10 ring-1 ring-[#E8141C]" : ""}`}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={it.img.url} alt="" className="h-6 w-6 rounded border object-contain" />
                <button className="min-w-0 flex-1 truncate text-left" onClick={() => { goToPage(it.page); useImages.getState().set({ selected: it.id }); }}>p{it.page + 1} · {it.img.name}</button>
                <button className="text-red-600 underline" onClick={() => removeImage(it.id)} aria-label={`Remove ${it.img.name}`}>Remove</button>
              </li>))}
          </ul>)}
        {onImagesToPdf && <button className="mt-2 inline-flex items-center gap-1 text-xs underline" onClick={onImagesToPdf}><Images aria-hidden className="h-3.5 w-3.5" />Create a PDF from images…</button>}
      </section>
      <section aria-labelledby="imgx-h" data-testid="export-panel">
        <h2 id="imgx-h" className="mb-1 flex items-center gap-1 font-semibold"><ImageDown aria-hidden className="h-4 w-4" />Export pages as images</h2>
        <div className="grid grid-cols-2 gap-1 text-xs">
          <label className="flex flex-col">Format<select aria-label="Image format" value={fmt} onChange={(e) => setFmt(e.target.value as "png" | "jpeg")} className="rounded border px-1 py-0.5 dark:bg-neutral-800"><option value="png">PNG</option><option value="jpeg">JPEG</option></select></label>
          <label className="flex flex-col">Resolution<select aria-label="Resolution" value={dpi} onChange={(e) => setDpi(Number(e.target.value))} className="rounded border px-1 py-0.5 dark:bg-neutral-800">{[72, 150, 300].map((d) => <option key={d} value={d}>{d} dpi</option>)}</select></label>
        </div>
        <fieldset className="mt-1 flex flex-wrap items-center gap-x-2 text-xs"><legend className="sr-only">Pages</legend>
          <label><input type="radio" name="xr" checked={range === "current"} onChange={() => setRange("current")} /> Page {currentPage + 1}</label>
          <label><input type="radio" name="xr" checked={range === "all"} onChange={() => setRange("all")} /> All ({pageSizes.length})</label>
          <label><input type="radio" name="xr" checked={range === "custom"} onChange={() => setRange("custom")} /> Pages</label>
          {range === "custom" && <input aria-label="Pages to export" placeholder="1-3, 5" value={custom} onChange={(e) => setCustom(e.target.value)} className="w-20 rounded border px-1 dark:bg-neutral-800" />}
        </fieldset>
        <button className="mt-1 rounded bg-ink px-2 py-1 text-xs text-white disabled:opacity-40 dark:bg-neutral-700" disabled={!!progress} onClick={() => void doExport()} data-testid="export-images">{progress ? `Exporting ${progress}…` : "Export"}</button>
      </section>
    </>
  );
}
