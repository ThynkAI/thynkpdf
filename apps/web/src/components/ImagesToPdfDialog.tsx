"use client";
import { useEffect, useRef, useState } from "react";
import { ArrowDown, ArrowUp, ImagePlus, Images, X } from "lucide-react";
import { IMAGE_ACCEPT, imagesToPdf, toEmbeddable, type Embeddable, type PageSize } from "@/lib/images";

interface Item { id: string; img: Embeddable; url: string }
let n = 0;

/** Create a PDF from several images: reorder (buttons or Alt+↑/↓), remove, pick page size, then open the new PDF. */
export function ImagesToPdfDialog({ initial, onClose, onCreate }: { initial: File[]; onClose(): void; onCreate(file: File): void }) {
  const [items, setItems] = useState<Item[]>([]); const [err, setErr] = useState<string | null>(null);
  const [size, setSize] = useState<PageSize>("fit"); const [busy, setBusy] = useState(false); const [name, setName] = useState("images.pdf");
  const input = useRef<HTMLInputElement>(null); const close = useRef<HTMLButtonElement>(null);
  const add = async (files: File[]) => {
    const out: Item[] = []; const bad: string[] = [];
    for (const f of files) { try { const img = await toEmbeddable(f); out.push({ id: `i${n++}`, img, url: URL.createObjectURL(new Blob([img.bytes as BlobPart], { type: img.mime })) }); } catch (e) { bad.push((e as Error).message); } }
    setItems((x) => { if (!x.length && out[0]) setName(out[0].img.name.replace(/\.[^.]+$/, "") + ".pdf"); return [...x, ...out]; });
    setErr(bad.length ? bad.join(" · ") : null);
  };
  useEffect(() => { close.current?.focus(); if (initial.length) void add(initial); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);
  const urls = useRef<string[]>([]);
  useEffect(() => { urls.current = items.map((i) => i.url); }, [items]);
  useEffect(() => () => urls.current.forEach((u) => URL.revokeObjectURL(u)), []);
  const mv = (i: number, d: -1 | 1) => setItems((x) => { const a = [...x]; const j = i + d; if (j < 0 || j >= a.length) return x; [a[i], a[j]] = [a[j], a[i]]; return a; });
  const create = async () => {
    setBusy(true); setErr(null);
    try { const pdf = await imagesToPdf(items.map((i) => i.img), size); const nm = /\.pdf$/i.test(name) ? name : `${name}.pdf`; onCreate(new File([pdf as BlobPart], nm, { type: "application/pdf" })); onClose(); }
    catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/50 p-4" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }} onKeyDown={(e) => { if (e.key === "Escape") onClose(); }}>
      <div role="dialog" aria-modal="true" aria-labelledby="i2p-h" data-testid="images-to-pdf" className="flex max-h-[85vh] w-full max-w-lg flex-col rounded-xl bg-white p-4 text-sm shadow-xl dark:bg-neutral-900">
        <div className="mb-2 flex items-center gap-2">
          <Images aria-hidden className="h-5 w-5 text-[#E8141C]" /><h2 id="i2p-h" className="text-base font-semibold">Create PDF from images</h2>
          <button ref={close} aria-label="Close" className="ml-auto rounded p-1 hover:bg-neutral-100 dark:hover:bg-neutral-800" onClick={onClose}><X className="h-4 w-4" /></button>
        </div>
        <input ref={input} type="file" accept={IMAGE_ACCEPT} multiple hidden data-testid="i2p-input" onChange={(e) => { void add(Array.from(e.target.files ?? [])); e.target.value = ""; }} />
        <ol className="min-h-24 flex-1 space-y-1 overflow-auto rounded border border-neutral-200 p-1 dark:border-neutral-800" aria-label="Pages in order" data-testid="i2p-list">
          {items.length === 0 && <li className="p-4 text-center text-xs text-neutral-500">No images yet.</li>}
          {items.map((it, i) => (
            <li key={it.id} tabIndex={0} className="flex items-center gap-2 rounded px-1 py-0.5 hover:bg-neutral-50 focus:outline focus:outline-2 focus:outline-brand-500 dark:hover:bg-neutral-800"
              onKeyDown={(e) => { if (e.altKey && e.key === "ArrowUp") { e.preventDefault(); mv(i, -1); } if (e.altKey && e.key === "ArrowDown") { e.preventDefault(); mv(i, 1); } }}>
              <span className="w-5 text-right text-xs text-neutral-500">{i + 1}</span>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={it.url} alt="" className="h-10 w-10 rounded border object-contain" />
              <span className="min-w-0 flex-1 truncate text-xs">{it.img.name}<span className="text-neutral-500"> · {it.img.width}×{it.img.height}</span></span>
              <button aria-label={`Move ${it.img.name} up`} disabled={i === 0} onClick={() => mv(i, -1)} className="rounded p-1 hover:bg-neutral-200 disabled:opacity-30 dark:hover:bg-neutral-700"><ArrowUp className="h-3.5 w-3.5" /></button>
              <button aria-label={`Move ${it.img.name} down`} disabled={i === items.length - 1} onClick={() => mv(i, 1)} className="rounded p-1 hover:bg-neutral-200 disabled:opacity-30 dark:hover:bg-neutral-700"><ArrowDown className="h-3.5 w-3.5" /></button>
              <button aria-label={`Remove ${it.img.name}`} onClick={() => setItems((x) => x.filter((y) => y.id !== it.id))} className="rounded p-1 hover:bg-neutral-200 dark:hover:bg-neutral-700"><X className="h-3.5 w-3.5" /></button>
            </li>))}
        </ol>
        {err && <p role="alert" className="mt-1 text-xs text-red-600">{err}</p>}
        <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
          <label className="flex flex-col">Page size<select aria-label="Page size" value={size} onChange={(e) => setSize(e.target.value as PageSize)} className="rounded border px-1 py-1 dark:bg-neutral-800"><option value="fit">Fit each image</option><option value="a4">A4</option><option value="letter">Letter</option></select></label>
          <label className="flex flex-col">File name<input aria-label="PDF file name" value={name} onChange={(e) => setName(e.target.value)} className="rounded border px-1 py-1 dark:bg-neutral-800" /></label>
        </div>
        <div className="mt-3 flex items-center gap-2">
          <button className="inline-flex items-center gap-1 rounded border px-2 py-1 text-xs dark:border-neutral-700" onClick={() => input.current?.click()} data-testid="i2p-add"><ImagePlus className="h-3.5 w-3.5" />Add images</button>
          <span className="text-[11px] text-neutral-500">Alt+↑/↓ reorders</span>
          <button className="ml-auto rounded bg-[#E8141C] px-3 py-1 font-semibold text-white disabled:opacity-40" disabled={!items.length || busy} onClick={() => void create()} data-testid="i2p-create">{busy ? "Creating…" : `Create PDF (${items.length} page${items.length === 1 ? "" : "s"})`}</button>
        </div>
      </div>
    </div>
  );
}
