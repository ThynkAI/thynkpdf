"use client";
import { useAnnot, COLORS, STAMPS, type Tool } from "@/lib/annotState";
import { saveAnnotations, discardAnnotations } from "@/lib/annotActions";
import { useSession } from "@/lib/session";

const TOOLS: { t: Tool; label: string; icon: string }[] = [
  { t: "none", label: "Select text", icon: "I" }, { t: "highlight", label: "Highlight (select text)", icon: "▮" }, { t: "underline", label: "Underline (select text)", icon: "U̲" },
  { t: "strikeout", label: "Strikethrough (select text)", icon: "S̶" }, { t: "ink", label: "Pencil / ink", icon: "✎" }, { t: "eraser", label: "Eraser (click an annotation)", icon: "⌫" },
  { t: "note", label: "Sticky note", icon: "🗨" }, { t: "freetext", label: "Text comment", icon: "T" }, { t: "callout", label: "Callout (drag from target to box)", icon: "↖T" },
  { t: "square", label: "Rectangle", icon: "▭" }, { t: "circle", label: "Ellipse", icon: "◯" }, { t: "line", label: "Line", icon: "╱" }, { t: "arrow", label: "Arrow", icon: "➚" },
  { t: "stamp", label: "Stamp", icon: "▣" },
];

export function AnnotToolbar() {
  const a = useAnnot(); const busy = useSession((s) => s.busy);
  return (
    <div role="toolbar" aria-label="Annotation tools" className="flex flex-wrap items-center gap-1 border-b border-neutral-200 bg-white px-2 py-1 text-xs dark:border-neutral-800 dark:bg-neutral-950">
      {TOOLS.map(({ t, label, icon }) => (
        <button key={t} type="button" title={label} aria-pressed={a.tool === t} onClick={() => a.set({ tool: t })}
          className={`h-7 min-w-7 rounded px-1.5 ${a.tool === t ? "bg-brand-600 text-white" : "hover:bg-neutral-100 dark:hover:bg-neutral-800"}`}><span aria-hidden="true">{icon}</span><span className="sr-only">{label}</span></button>
      ))}
      <span className="mx-1 h-4 w-px bg-neutral-300" />
      <div role="radiogroup" aria-label="Color" className="flex gap-0.5">
        {COLORS.map((c) => (
          <button key={c.name} role="radio" aria-checked={a.color === c.rgb} aria-label={c.name} onClick={() => a.set({ color: c.rgb })}
            className={`h-5 w-5 rounded-full border ${a.color === c.rgb ? "ring-2 ring-brand-500 ring-offset-1" : ""}`} style={{ background: `rgb(${c.rgb.map((x) => x * 255).join(",")})` }} />
        ))}
      </div>
      {a.tool === "stamp" && (
        <select aria-label="Stamp" value={a.stamp} onChange={(e) => a.set({ stamp: e.target.value })} className="rounded border py-0.5 dark:bg-neutral-800">{STAMPS.map((s) => <option key={s}>{s}</option>)}</select>
      )}
      <input aria-label="Comment text" placeholder="Comment / note text" value={a.text} onChange={(e) => a.set({ text: e.target.value })} className="w-44 rounded border px-1.5 py-0.5 dark:border-neutral-700 dark:bg-neutral-800" />
      <input aria-label="Author name" placeholder="Your name" value={a.author} onChange={(e) => { a.set({ author: e.target.value }); try { localStorage.setItem("tp-author", e.target.value); } catch { /* */ } }}
        className="w-32 rounded border px-1.5 py-0.5 dark:border-neutral-700 dark:bg-neutral-800" />
      <div className="ml-auto flex items-center gap-1" data-testid="annot-save-bar">
        {a.working?.dirty && <span className="text-amber-700">Unsaved annotations</span>}
        {a.working && <>
          <button className="rounded bg-brand-600 px-2 py-1 text-white disabled:opacity-40" disabled={!!busy} onClick={() => void saveAnnotations()}>{a.working.originRef ? "Save as new document" : "Save"}</button>
          <button className="rounded border px-2 py-1 dark:border-neutral-700" disabled={!!busy} onClick={() => void discardAnnotations()}>Discard</button>
        </>}
        {a.downloadUrl && <a className="underline" href={a.downloadUrl} download={a.downloadName ?? "annotated.pdf"} data-testid="download-annotated">Download</a>}
      </div>
    </div>
  );
}
