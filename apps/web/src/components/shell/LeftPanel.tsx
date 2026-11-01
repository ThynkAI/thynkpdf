"use client";
import { useEffect, useState } from "react";
import { LayoutGrid, Bookmark, MessageSquare, Trash2 } from "lucide-react";
import { eraseAnnotations } from "@/lib/annotActions";
import { useViewerStore } from "@thynkpdf/pdf-viewer";
import { Thumbnails } from "@thynkpdf/pdf-viewer/client";
import { useAnnot } from "@/lib/annotState";

type Tab = "thumbs" | "bookmarks" | "comments";
type OutlineItem = { title: string; page: number | null; items: OutlineItem[] };

/** Left panel: page thumbnails, document bookmarks (PDF outline) and a compact comment list. */
export function LeftPanel({ onReorder, reorderDisabledReason }: { onReorder(f: number, t: number): void; reorderDisabledReason?: string | null }) {
  const [tab, setTab] = useState<Tab>("thumbs");
  const tabs: { id: Tab; label: string; Icon: typeof Bookmark }[] = [
    { id: "thumbs", label: "Pages", Icon: LayoutGrid }, { id: "bookmarks", label: "Bookmarks", Icon: Bookmark }, { id: "comments", label: "Comments", Icon: MessageSquare },
  ];
  return (
    <div className="flex h-full flex-col">
      <div role="tablist" aria-label="Left panel" className="flex shrink-0 border-b border-neutral-200 dark:border-neutral-800">
        {tabs.map(({ id, label, Icon }) => (
          <button key={id} role="tab" id={`lp-tab-${id}`} aria-controls={`lp-${id}`} aria-selected={tab === id} title={label} onClick={() => setTab(id)}
            className={`flex flex-1 items-center justify-center py-2 ${tab === id ? "border-b-2 border-brand-600 text-brand-700 dark:text-brand-300" : "text-neutral-600 hover:text-neutral-900 dark:text-neutral-400"}`}>
            <Icon aria-hidden className="h-4 w-4" /><span className="sr-only">{label}</span>
          </button>
        ))}
      </div>
      <div role="tabpanel" id={`lp-${tab}`} aria-labelledby={`lp-tab-${tab}`} className="min-h-0 flex-1 overflow-auto">
        {tab === "thumbs" && <Thumbnails onReorder={onReorder} reorderDisabledReason={reorderDisabledReason ?? undefined} />}
        {tab === "bookmarks" && <Bookmarks />}
        {tab === "comments" && <CommentList />}
      </div>
    </div>
  );
}

function Bookmarks() {
  const doc = useViewerStore((s) => s.doc);
  const goToPage = useViewerStore((s) => s.goToPage);
  const [items, setItems] = useState<OutlineItem[] | null>(null);
  useEffect(() => {
    let live = true; setItems(null);
    if (!doc) { setItems([]); return; }
    type Raw = { title: string; dest: unknown; items: Raw[] };
    const resolve = async (o: Raw): Promise<OutlineItem> => {
      let page: number | null = null;
      try {
        const dest = typeof o.dest === "string" ? await doc.getDestination(o.dest) : (o.dest as unknown[] | null);
        if (dest && dest[0]) page = typeof dest[0] === "number" ? dest[0] : await doc.getPageIndex(dest[0] as never);
      } catch { /* unresolved destination: listed without a link */ }
      return { title: o.title, page, items: await Promise.all((o.items ?? []).map(resolve)) };
    };
    void doc.getOutline().then(async (o) => { const r = await Promise.all(((o ?? []) as Raw[]).map(resolve)); if (live) setItems(r); }).catch(() => live && setItems([]));
    return () => { live = false; };
  }, [doc]);
  if (!doc) return <p className="p-3 text-xs text-neutral-500">No document open.</p>;
  if (!items) return <p className="p-3 text-xs text-neutral-500">Reading bookmarks…</p>;
  if (!items.length) return <p className="p-3 text-xs text-neutral-500" data-testid="no-bookmarks">This PDF has no bookmarks.</p>;
  const render = (list: OutlineItem[], depth: number) => (
    <ul className={depth ? "ml-3" : ""}>
      {list.map((b, i) => (
        <li key={i}>
          <button disabled={b.page === null} onClick={() => b.page !== null && goToPage(b.page)} className="w-full truncate rounded px-2 py-1 text-left text-xs hover:bg-neutral-200 disabled:opacity-60 dark:hover:bg-neutral-800">{b.title}</button>
          {b.items.length > 0 && render(b.items, depth + 1)}
        </li>
      ))}
    </ul>
  );
  return <div className="p-1" data-testid="bookmarks">{render(items, 0)}</div>;
}

function CommentList() {
  const threads = useAnnot((a) => a.threads);
  const selected = useAnnot((a) => a.selected);
  const goToPage = useViewerStore((s) => s.goToPage);
  if (!threads.length) return <p className="p-3 text-xs text-neutral-500">No comments yet. Use the Comment tool to add some.</p>;
  return (
    <ul className="space-y-1 p-1" data-testid="left-comments">
      {threads.map((t, i) => { const on = selected.includes(t.root.id); return (
        <li key={i} className={`group flex items-start rounded ${on ? "bg-[#E8141C]/10 ring-1 ring-[#E8141C]" : ""}`} data-testid="left-comment">
          <button onClick={(e) => { goToPage(t.root.page); const cur = useAnnot.getState().selected; useAnnot.getState().set({ selected: e.shiftKey ? (on ? cur.filter((x) => x !== t.root.id) : [...cur, t.root.id]) : [t.root.id] }); }}
            className="min-w-0 flex-1 rounded px-2 py-1 text-left text-xs hover:bg-neutral-200 dark:hover:bg-neutral-800">
            <span className="block truncate font-medium">{t.root.contents || t.root.subtype}</span>
            <span className="text-neutral-500">p{t.root.page + 1}{t.root.author ? ` · ${t.root.author}` : ""}</span>
          </button>
          <button aria-label={`Delete ${t.root.contents || t.root.subtype} on page ${t.root.page + 1}`} title="Delete (Del)" onClick={() => void eraseAnnotations([t.root.id])}
            className="m-1 rounded p-1 text-neutral-500 hover:bg-red-100 hover:text-[#E8141C] dark:hover:bg-neutral-800"><Trash2 aria-hidden className="h-3.5 w-3.5" /></button>
        </li>); })}
    </ul>
  );
}
