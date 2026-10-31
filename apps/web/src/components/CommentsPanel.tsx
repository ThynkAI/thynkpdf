"use client";
import { useEffect, useState } from "react";
import { useViewerStore } from "@thynkpdf/pdf-viewer";
import { useAnnot } from "@/lib/annotState";
import { applyEdit, authorName, refreshThreads } from "@/lib/annotActions";
import { addReply, setReviewState, deleteAnnotation } from "@/lib/annotWrite";

const fmt = (d: Date | null) => (d ? d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "");
const LABEL: Record<string, string> = { Text: "Note", FreeText: "Text comment", Highlight: "Highlight", Underline: "Underline", StrikeOut: "Strikethrough", Ink: "Ink", Square: "Rectangle", Circle: "Ellipse", Line: "Line", Stamp: "Stamp", Polygon: "Polygon", PolyLine: "Polyline" };

export function CommentsPanel() {
  const docKey = useViewerStore((s) => s.docKey); const goToPage = useViewerStore((s) => s.goToPage); const has = useViewerStore((s) => s.pageSizes.length > 0);
  const { threads } = useAnnot();
  const [reply, setReply] = useState<Record<string, string>>({});
  const [filter, setFilter] = useState<"open" | "all">("all");
  useEffect(() => { void refreshThreads(); }, [docKey]);
  if (!has) return null;
  const shown = threads.filter((t) => filter === "all" || !t.resolved);
  return (
    <section aria-labelledby="cm-h">
      <div className="mb-1 flex items-center">
        <h2 id="cm-h" className="font-semibold">Comments <span className="text-xs font-normal text-neutral-500" data-testid="thread-count">({threads.length})</span></h2>
        <select aria-label="Filter comments" className="ml-auto rounded border py-0.5 text-xs dark:bg-neutral-800" value={filter} onChange={(e) => setFilter(e.target.value as "open" | "all")}><option value="all">All</option><option value="open">Open only</option></select>
      </div>
      {shown.length === 0 && <p className="text-xs text-neutral-500">No annotations.</p>}
      <ul className="space-y-2" data-testid="threads">
        {shown.map((t) => (
          <li key={t.root.id} className={`rounded border p-2 text-xs dark:border-neutral-700 ${t.resolved ? "opacity-70" : ""}`} data-testid="thread">
            <div className="flex items-center gap-1">
              <button className="font-semibold underline" onClick={() => goToPage(t.root.page)}>{LABEL[t.root.subtype] ?? t.root.subtype} · p{t.root.page + 1}</button>
              {t.resolved && <span className="rounded bg-green-100 px-1 text-green-800 dark:bg-green-900 dark:text-green-200" data-testid="resolved-badge">Resolved</span>}
            </div>
            <p className="text-neutral-500"><span data-testid="author">{t.root.author || "Unknown"}</span> · <time dateTime={t.root.created?.toISOString()}>{fmt(t.root.created ?? t.root.modified)}</time></p>
            {t.root.contents && <p className="mt-1 whitespace-pre-wrap" data-testid="contents">{t.root.contents}</p>}
            {t.replies.map((r) => (
              <div key={r.id} className="mt-1 border-l-2 pl-2 dark:border-neutral-700" data-testid="reply">
                <p className="text-neutral-500">{r.author} · <time dateTime={r.created?.toISOString()}>{fmt(r.created)}</time></p>
                <p className="whitespace-pre-wrap">{r.contents}</p>
              </div>))}
            {t.stateBy && <p className="mt-1 text-[11px] text-neutral-500">{t.resolved ? "Resolved" : "Reopened"} by {t.stateBy} {fmt(t.stateAt ?? null)}</p>}
            <form className="mt-1 flex gap-1" onSubmit={async (e) => { e.preventDefault(); const v = (reply[t.root.id] ?? "").trim(); if (!v) return;
              if (await applyEdit("Reply", async (b) => (await addReply(b, t.root.id, authorName(), v)).bytes)) setReply({ ...reply, [t.root.id]: "" }); }}>
              <input aria-label={`Reply to ${LABEL[t.root.subtype] ?? "annotation"} on page ${t.root.page + 1}`} placeholder="Reply…" value={reply[t.root.id] ?? ""} onChange={(e) => setReply({ ...reply, [t.root.id]: e.target.value })}
                className="min-w-0 flex-1 rounded border px-1 py-0.5 dark:border-neutral-700 dark:bg-neutral-800" />
              <button className="rounded border px-1.5 dark:border-neutral-700">Reply</button>
            </form>
            <div className="mt-1 flex gap-2">
              <button className="underline" onClick={() => void applyEdit(t.resolved ? "Reopen" : "Resolve", async (b) => (await setReviewState(b, t.root.id, authorName(), !t.resolved)).bytes)}>{t.resolved ? "Reopen" : "Resolve"}</button>
              <button className="underline text-red-600" onClick={() => void applyEdit("Delete", (b) => deleteAnnotation(b, t.root.id))}>Delete</button>
            </div>
          </li>))}
      </ul>
    </section>
  );
}
