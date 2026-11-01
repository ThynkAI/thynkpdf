"use client";
import { useEffect, useRef, useState } from "react";
import { useViewerStore, moveOrder } from "@thynkpdf/pdf-viewer";
import { PageView } from "@thynkpdf/pdf-viewer/client";
import type { DocumentInfo, UploadResponse } from "@thynkpdf/editor-client";
import { useSession } from "@/lib/session";
import { editGate, readOnlyView } from "@/lib/gates";
import { runVersionedOp, http, rotatePages, reorderTo, newDocOp, openLatest, deletePages, duplicatePages, insertBlankAfter, insertFromDoc } from "@/lib/documents";
import { parseRanges } from "@/lib/ranges";

const TILE = 110;

export function Organizer({ onClose, focus: initialFocus = "pages" }: { onClose(): void; focus?: "pages" | "compress" }) {
  const { doc, docKey, pageSizes } = useViewerStore();
  const s = useSession();
  const [sel, setSel] = useState<Set<number>>(new Set());
  const [focus, setFocus] = useState(0);
  const [ranges, setRanges] = useState("");
  const [rangeErr, setRangeErr] = useState<string | null>(null);
  const [created, setCreated] = useState<UploadResponse[]>([]);
  const [docs, setDocs] = useState<DocumentInfo[] | null>(null);
  const [mergeSel, setMergeSel] = useState<string[]>([]);
  const tiles = useRef<(HTMLDivElement | null)[]>([]);
  const dialog = useRef<HTMLDivElement>(null);
  const rot = editGate("rotate", s.ref, s.caps, { busy: !!s.busy, capsError: s.capsError, readOnly: readOnlyView(s) });
  const ro = editGate("reorder", s.ref, s.caps, { busy: !!s.busy, capsError: s.capsError, readOnly: readOnlyView(s) });
  const del = editGate("delete", s.ref, s.caps, { busy: !!s.busy, capsError: s.capsError, readOnly: readOnlyView(s) });
  const dup = editGate("duplicate", s.ref, s.caps, { busy: !!s.busy, capsError: s.capsError, readOnly: readOnlyView(s) });
  const ins = editGate("insert_blank", s.ref, s.caps, { busy: !!s.busy, capsError: s.capsError, readOnly: readOnlyView(s) });
  const [confirmDel, setConfirmDel] = useState(false);
  const [insSrc, setInsSrc] = useState("");
  const [preset, setPreset] = useState<"low" | "balanced" | "high">("balanced");
  const [compressMsg, setCompressMsg] = useState<string | null>(null);
  const compressRef = useRef<HTMLDivElement>(null);
  useEffect(() => { if (initialFocus === "compress") compressRef.current?.scrollIntoView({ block: "nearest" }); }, [initialFocus]);
  const compressGate = !s.ref ? "Compression runs on the server: sign in and open a server document." : s.busy ? "Another operation is in progress." : null;
  const newOps = s.ref && s.caps?.page_ops.extract ? null : (s.ref ? "Checking capabilities…" : "Requires a server document.");
  const selected = [...sel].sort((a, b) => a - b).map((i) => i + 1);

  useEffect(() => { setSel(new Set()); }, [docKey]);
  useEffect(() => { tiles.current[focus]?.focus(); }, [focus, docKey]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey); return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  useEffect(() => { if (s.ref) s.api.listDocuments({ limit: 100 }).then((p) => setDocs(p.items), () => setDocs([])); }, [s.ref, s.api]);

  const move = async (from: number, to: number) => {
    if (!ro.enabled || to < 0 || to >= pageSizes.length) return;
    if (await reorderTo(moveOrder(pageSizes.length, from, to))) setFocus(to);
  };
  const toggle = (i: number) => setSel((p) => { const n = new Set(p); if (n.has(i)) n.delete(i); else n.add(i); return n; });
  const addCreated = (r: UploadResponse | UploadResponse[] | null) => { if (r) setCreated((c) => [...(Array.isArray(r) ? r : [r]), ...c]); };
  const btn = "rounded border border-neutral-300 px-2 py-1 text-xs disabled:opacity-40 dark:border-neutral-700";

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40 p-4" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div ref={dialog} role="dialog" aria-modal="true" aria-labelledby="org-h" className="flex max-h-full w-full max-w-5xl flex-col rounded-lg bg-white shadow-xl dark:bg-neutral-900">
        <header className="flex items-center gap-2 border-b p-3 dark:border-neutral-800">
          <h2 id="org-h" className="font-semibold">Organize pages</h2>
          <span className="text-xs text-neutral-500">{selected.length ? `${selected.length} selected` : "Click to select · Alt+←/→ to move the focused page"}</span>
          <button className="ml-auto rounded px-2 py-1 hover:bg-neutral-100 dark:hover:bg-neutral-800" onClick={onClose} aria-label="Close organizer">✕</button>
        </header>
        <div className="flex flex-wrap items-center gap-1 border-b p-2 dark:border-neutral-800" role="toolbar" aria-label="Page actions">
          <button className={btn} disabled={!rot.enabled || !selected.length} title={rot.reason ?? undefined} onClick={() => rotatePages(selected, -90)}>⟲ Rotate left</button>
          <button className={btn} disabled={!rot.enabled || !selected.length} title={rot.reason ?? undefined} onClick={() => rotatePages(selected, 90)}>⟳ Rotate right</button>
          <button className={btn} disabled={!ro.enabled || selected.length !== 1} title={ro.reason ?? "Select one page"} onClick={() => move(selected[0] - 1, selected[0] - 2).then(() => setSel(new Set([selected[0] - 2])))}>Move earlier</button>
          <button className={btn} disabled={!ro.enabled || selected.length !== 1} title={ro.reason ?? "Select one page"} onClick={() => move(selected[0] - 1, selected[0]).then(() => setSel(new Set([selected[0]])))}>Move later</button>
          <button className={btn} disabled={!!newOps || !selected.length} title={newOps ?? "Creates a new document"} onClick={async () => addCreated(await newDocOp("Extract", () => s.api.extractPages(s.ref!.document_id, selected)))}>Extract to new PDF</button>
          <span className="mx-1 h-4 w-px bg-neutral-300" />
          {!confirmDel ? (
            <button className={btn} disabled={!del.enabled || !selected.length || selected.length >= pageSizes.length} title={del.reason ?? (selected.length >= pageSizes.length ? "Cannot delete every page" : "Delete the selected pages (creates a new version)")} onClick={() => setConfirmDel(true)}>Delete</button>
          ) : (
            <span role="group" aria-label="Confirm delete" className="flex items-center gap-1 text-xs">
              Delete {selected.length} page{selected.length === 1 ? "" : "s"}? (Earlier versions keep them.)
              <button className={`${btn} border-red-400 text-red-700`} onClick={async () => { setConfirmDel(false); if (await deletePages(selected)) setSel(new Set()); }}>Confirm delete</button>
              <button className={btn} onClick={() => setConfirmDel(false)}>Cancel</button>
            </span>
          )}
          <button className={btn} disabled={!dup.enabled || !selected.length} title={dup.reason ?? "Duplicate each selected page after itself (annotations are not copied)"} onClick={async () => { if (await duplicatePages(selected)) setSel(new Set()); }}>Duplicate</button>
          <button className={btn} disabled={!ins.enabled} title={ins.reason ?? "Insert a blank page after the focused page"} onClick={async () => { if (await insertBlankAfter(focus + 1)) setFocus(focus + 1); }}>Insert blank page</button>
          <select aria-label="Insert pages from document" className="rounded border px-1 py-1 text-xs dark:border-neutral-700 dark:bg-neutral-800" value={insSrc} onChange={(e) => setInsSrc(e.target.value)} disabled={!ins.enabled}>
            <option value="">Insert from PDF…</option>
            {(docs ?? []).filter((d) => d.document_id !== s.ref?.document_id).slice(0, 50).map((d) => <option key={d.document_id} value={d.document_id}>{d.filename}</option>)}
          </select>
          <button className={btn} disabled={!ins.enabled || !insSrc} title={ins.reason ?? "Insert all pages of the chosen document after the focused page"} onClick={async () => { if (await insertFromDoc(insSrc, focus + 1)) setInsSrc(""); }}>Insert</button>
        </div>
        <div className="grid min-h-0 flex-1 grid-cols-[repeat(auto-fill,minmax(130px,1fr))] gap-3 overflow-auto p-3" role="listbox" aria-label="Pages" aria-multiselectable="true">
          {doc && pageSizes.map((sz, i) => {
            const scale = TILE / sz.width;
            return (
              <div key={`${docKey}-${i}`} ref={(el) => { tiles.current[i] = el; }} role="option" aria-selected={sel.has(i)} tabIndex={i === focus ? 0 : -1}
                data-testid={`org-page-${i + 1}`} aria-label={`Page ${i + 1}`}
                onClick={() => { setFocus(i); toggle(i); }}
                onKeyDown={(e) => {
                  const d = e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : 0;
                  if (d && e.altKey) { e.preventDefault(); void move(i, i + d); }
                  else if (d) { e.preventDefault(); setFocus(Math.max(0, Math.min(pageSizes.length - 1, i + d))); }
                  else if (e.key === " " || e.key === "Enter") { e.preventDefault(); toggle(i); }
                }}
                className={`flex cursor-pointer flex-col items-center gap-1 rounded p-2 outline-none focus-visible:ring-2 focus-visible:ring-brand-500 ${sel.has(i) ? "bg-brand-500/20 ring-2 ring-brand-500" : "hover:bg-neutral-100 dark:hover:bg-neutral-800"}`}>
                <PageView doc={doc} pageIndex={i} scale={scale} width={TILE} height={Math.round(sz.height * scale)} textLayer={false} label={`Organizer page ${i + 1}`} />
                <span className="text-xs">{i + 1}</span>
              </div>
            );
          })}
        </div>
        <div ref={compressRef} data-testid="compress-section" className={`flex flex-wrap items-center gap-2 border-t p-2 text-xs dark:border-neutral-800 ${initialFocus === "compress" ? "bg-brand-500/10" : ""}`}>
          <span className="font-semibold">Compress</span>
          <select aria-label="Compression level" value={preset} onChange={(e) => setPreset(e.target.value as typeof preset)} className="rounded border dark:border-neutral-700 dark:bg-neutral-800">
            <option value="low">Light (best quality)</option><option value="balanced">Balanced</option><option value="high">Strong (smallest)</option>
          </select>
          <button className={btn} disabled={!!compressGate} title={compressGate ?? "Creates a new version if it gets smaller"} onClick={async () => {
            setCompressMsg(null);
            let rep: Record<string, unknown> | null = null;
            const before = s.ref?.version;
            const ok = await runVersionedOp("Compress", async (r) => { const v = await http().compress(r, preset); rep = v.report ?? null; return v; });
            if (ok && rep) { const r = rep as { new_version_created?: boolean; original_size?: number; final_size?: number };
              setCompressMsg(r.new_version_created ? `Compressed${r.original_size && r.final_size ? `: ${Math.round(r.original_size / 1024)} KB → ${Math.round(r.final_size / 1024)} KB` : ""} (now v${useSession.getState().ref?.version}).` : `Already compact — no smaller version could be made (still v${before}).`); }
          }}>Compress</button>
          {compressGate && <span className="text-neutral-500">{compressGate}</span>}
          {compressMsg && <span role="status" data-testid="compress-result">{compressMsg}</span>}
        </div>
        <footer className="grid gap-3 border-t p-3 text-xs sm:grid-cols-3 dark:border-neutral-800">
          <form onSubmit={async (e) => {
            e.preventDefault(); const r = parseRanges(ranges, pageSizes.length);
            if ("error" in r) return setRangeErr(r.error);
            setRangeErr(null); addCreated(await newDocOp("Split", () => s.api.splitDocument(s.ref!.document_id, r.ranges)));
          }}>
            <label className="block font-semibold" htmlFor="split-ranges">Split into new PDFs</label>
            <div className="mt-1 flex gap-1">
              <input id="split-ranges" value={ranges} onChange={(e) => setRanges(e.target.value)} placeholder="e.g. 1-2, 3" disabled={!!newOps}
                className="min-w-0 flex-1 rounded border px-2 py-1 dark:bg-neutral-800" />
              <button className={btn} disabled={!!newOps} title={newOps ?? undefined}>Split</button>
            </div>
            {rangeErr && <p role="alert" className="mt-1 text-red-600">{rangeErr}</p>}
          </form>
          <div>
            <p className="font-semibold">Merge with other documents</p>
            <div className="mt-1 max-h-24 overflow-auto rounded border p-1 dark:border-neutral-700" data-testid="merge-list">
              {docs === null ? <span className="text-neutral-500">{s.ref ? "Loading…" : "Requires a server document."}</span> :
                docs.filter((d) => d.document_id !== s.ref?.document_id).slice(0, 50).map((d) => (
                  <label key={d.document_id} className="flex items-center gap-1 truncate">
                    <input type="checkbox" checked={mergeSel.includes(d.document_id)} onChange={(e) => setMergeSel((m) => e.target.checked ? [...m, d.document_id] : m.filter((x) => x !== d.document_id))} />
                    <span className="truncate">{d.filename}</span>
                  </label>
                ))}
            </div>
            <button className={`${btn} mt-1`} disabled={!!newOps || !mergeSel.length} onClick={async () => { addCreated(await newDocOp("Merge", () => s.api.mergeDocuments([s.ref!.document_id, ...mergeSel], "merged.pdf"))); setMergeSel([]); }}>Merge (current first)</button>
          </div>
          <div>
            <p className="font-semibold">Created documents</p>
            <ul className="mt-1 max-h-28 space-y-1 overflow-auto" data-testid="created-docs">
              {created.length === 0 && <li className="text-neutral-500">None yet</li>}
              {created.map((c) => (
                <li key={c.document_id} className="flex items-center gap-1">
                  <span className="truncate">{c.page_count} page{c.page_count === 1 ? "" : "s"} · {c.document_id.slice(0, 8)}</span>
                  <button className="ml-auto underline" onClick={async () => { await newDocOp("Open", () => openLatest(c.document_id)); onClose(); }}>Open</button>
                </li>
              ))}
            </ul>
          </div>
        </footer>
      </div>
    </div>
  );
}
