"use client";
import { useAnnot, COLORS, STAMPS, type Tool } from "@/lib/annotState";
import { saveAnnotations, discardAnnotations } from "@/lib/annotActions";
import { useSession } from "@/lib/session";
import { TextCursor, Highlighter, Underline, Strikethrough, Pencil, Eraser, StickyNote, Type, MessageSquareText, Square, Circle, Slash, ArrowUpRight, Stamp, type LucideIcon } from "lucide-react";
import { Fragment } from "react";

// One consistent lucide icon per tool, chosen for what the tool actually does (see AnnotOverlay / annotState).
const TOOLS: { t: Tool; label: string; Icon: LucideIcon }[] = [
  { t: "none", label: "Select text", Icon: TextCursor },
  { t: "highlight", label: "Highlight (select text)", Icon: Highlighter },
  { t: "underline", label: "Underline (select text)", Icon: Underline },
  { t: "strikeout", label: "Strikethrough (select text)", Icon: Strikethrough },
  { t: "ink", label: "Pencil / ink", Icon: Pencil },
  { t: "eraser", label: "Eraser (click an annotation)", Icon: Eraser },
  { t: "note", label: "Sticky note", Icon: StickyNote },
  { t: "freetext", label: "Text comment", Icon: Type },
  { t: "callout", label: "Callout (drag from target to box)", Icon: MessageSquareText },
  { t: "square", label: "Rectangle", Icon: Square },
  { t: "circle", label: "Ellipse", Icon: Circle },
  { t: "line", label: "Line", Icon: Slash },
  { t: "arrow", label: "Arrow", Icon: ArrowUpRight },
  { t: "stamp", label: "Stamp", Icon: Stamp },
];
const GROUP_END = new Set<Tool>(["none", "strikeout", "eraser", "callout", "arrow"]);

export function AnnotToolbar() {
  const a = useAnnot(); const busy = useSession((s) => s.busy);
  const sessionServer = useSession((s) => s.api.kind === "http" && !!s.ref);
  return (
    <div role="toolbar" aria-label="Annotation tools" className="flex flex-wrap items-center gap-0.5 border-b border-neutral-200 bg-white px-2 py-1 text-xs dark:border-neutral-800 dark:bg-ink">
      {TOOLS.map(({ t, label, Icon }) => { const on = a.tool === t; return (
        <Fragment key={t}>
          <button type="button" title={label} aria-label={label} aria-pressed={on} data-tool={t} onClick={() => a.set({ tool: t })}
            className={`inline-flex h-8 w-8 items-center justify-center rounded-md transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 ${on ? "bg-brand-600 text-white shadow-sm ring-1 ring-brand-700 dark:bg-brand-500 dark:ring-brand-300" : "text-neutral-700 hover:bg-neutral-100 hover:text-neutral-900 dark:text-neutral-300 dark:hover:bg-neutral-800 dark:hover:text-white"}`}>
            <Icon aria-hidden strokeWidth={2} className="h-[18px] w-[18px] shrink-0" />
          </button>
          {GROUP_END.has(t) && <span aria-hidden className="mx-0.5 h-5 w-px bg-neutral-200 dark:bg-neutral-700" />}
        </Fragment>); })}
      <span aria-hidden className="mx-1 h-5 w-px bg-neutral-200 dark:bg-neutral-700" />
      <div role="radiogroup" aria-label="Color" className="flex gap-0.5">
        {COLORS.map((c) => (
          <button key={c.name} role="radio" aria-checked={a.color === c.rgb} aria-label={c.name} onClick={() => a.set({ color: c.rgb })}
            title={c.name} className={`h-5 w-5 rounded-full border border-neutral-300 dark:border-neutral-600 ${a.color === c.rgb ? "ring-2 ring-brand-500 ring-offset-1 dark:ring-offset-ink" : ""}`} style={{ background: `rgb(${c.rgb.map((x) => x * 255).join(",")})` }} />
        ))}
      </div>
      {a.tool === "stamp" && (
        <select aria-label="Stamp" value={a.stamp} onChange={(e) => a.set({ stamp: e.target.value })} className="rounded border py-0.5 dark:bg-neutral-800">{STAMPS.map((s) => <option key={s}>{s}</option>)}</select>
      )}
      <input aria-label="Comment text" placeholder="Comment / note text" value={a.text} onChange={(e) => a.set({ text: e.target.value })} className="w-44 rounded border px-1.5 py-0.5 dark:border-neutral-700 dark:bg-neutral-800" />
      <input aria-label="Author name" placeholder="Your name" value={a.author} onChange={(e) => { a.set({ author: e.target.value }); try { localStorage.setItem("tp-author", e.target.value); } catch { /* */ } }}
        className="w-32 rounded border px-1.5 py-0.5 dark:border-neutral-700 dark:bg-neutral-800" />
      <div className="ml-auto flex items-center gap-1" data-testid="annot-save-bar">
        {!a.working && sessionServer && <span className="text-neutral-500" data-testid="annot-server-mode">Each change is saved to the server as a new version</span>}
        {a.working?.dirty && <span className="text-amber-700">Unsaved annotations</span>}
        {a.working && <>
          <button className="rounded bg-brand-600 px-2 py-1 text-white disabled:opacity-40" disabled={!!busy} onClick={() => void saveAnnotations()}>{a.working.originRef ? "Save as new version" : "Save"}</button>
          <button className="rounded border px-2 py-1 dark:border-neutral-700" disabled={!!busy} onClick={() => void discardAnnotations()}>Discard</button>
        </>}
        {a.downloadUrl && <a className="underline" href={a.downloadUrl} download={a.downloadName ?? "annotated.pdf"} data-testid="download-annotated">Download</a>}
      </div>
    </div>
  );
}
