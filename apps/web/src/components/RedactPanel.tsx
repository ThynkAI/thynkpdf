"use client";
import { useEffect, useState } from "react";
import { useViewerStore } from "@thynkpdf/pdf-viewer";
import type { RedactMatch, RedactPattern } from "@thynkpdf/editor-client";
import { SquareDashed, TextSelect, ImageOff, FileX2, Trash2, ShieldCheck } from "lucide-react";
import { useSession } from "@/lib/session";
import { readOnlyView } from "@/lib/gates";
import { useRedact, syncDoc, addMarks, removeMarks, clearMarks, matchesToMarks, markWholePages, summary, PATTERN_LABELS, type RedactTool } from "@/lib/redact";
import { parseRanges } from "@/lib/ranges";
import { RedactApplyDialog } from "./RedactApplyDialog";

/** Gate: redaction runs in the THYNKPDF engine (desktop: the local engine, offline, no sign-in). Pure. */
export function redactGate(st: { ref: unknown; source: string; busy: string | null; backend: string }) {
  if (st.busy) return { enabled: false, reason: "Another operation is in progress." };
  if (readOnlyView(st as Parameters<typeof readOnlyView>[0])) return { enabled: false, reason: "You are viewing an older version (read-only)." };
  if (!st.ref) return { enabled: false, reason: "Redaction runs in the THYNKPDF engine, which is not available for this offline copy." };
  return { enabled: true, reason: null as string | null };
}

export const TOOL_BTNS: { id: Exclude<RedactTool, null>; label: string; hint: string; Icon: typeof SquareDashed }[] = [
  { id: "area", label: "Area", hint: "Drag a box over text, graphics or part of an image", Icon: SquareDashed },
  { id: "text", label: "Text", hint: "Select text on the page to mark it", Icon: TextSelect },
  { id: "image", label: "Image", hint: "Click an image to mark the whole image", Icon: ImageOff },
];

export function RedactToolButtons({ compact = false }: { compact?: boolean }) {
  const tool = useRedact((r) => r.tool);
  return (
    <div role="group" aria-label="Redaction mark tools" className="flex flex-wrap items-center gap-1">
      {TOOL_BTNS.map(({ id, label, hint, Icon }) => (
        <button key={id} type="button" aria-pressed={tool === id} title={hint} data-testid={`redact-tool-${id}`}
          onClick={() => { syncDoc(); useRedact.getState().set({ tool: tool === id ? null : id }); }}
          className={`inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs ${tool === id ? "border-[#E8141C] bg-[#E8141C] text-white" : "border-neutral-300 bg-white hover:border-[#E8141C] dark:border-neutral-700 dark:bg-neutral-800"}`}>
          <Icon aria-hidden className="h-3.5 w-3.5" strokeWidth={2} />{compact ? label : `Mark ${label.toLowerCase()}`}
        </button>))}
    </div>
  );
}

export function RedactPanel() {
  const s = useSession(); const { marks, selected } = useRedact();
  const { pageSizes, currentPage, goToPage } = useViewerStore();
  const [q, setQ] = useState(""); const [regex, setRegex] = useState(false); const [cs, setCs] = useState(false); const [ww, setWw] = useState(false);
  const [pats, setPats] = useState<RedactPattern[]>([]);
  const [results, setResults] = useState<RedactMatch[] | null>(null); const [pick, setPick] = useState<boolean[]>([]);
  const [pages, setPages] = useState(""); const [pagesErr, setPagesErr] = useState<string | null>(null);
  const [dialog, setDialog] = useState(false); const [searching, setSearching] = useState(false);
  const docId = s.ref?.document_id ?? null;
  useEffect(() => { syncDoc(); setResults(null); }, [docId]);
  if (!pageSizes.length) return null;
  const gate = redactGate(s);
  const search = async () => {
    if (!s.ref) return; setSearching(true); s.set({ error: null });
    try {
      const { http, describeError } = await import("@/lib/documents");
      try {
        const r = await http().redactSearch(s.ref.document_id, { query: q.trim() || undefined, regex, case_sensitive: cs, whole_word: ww, patterns: pats, version: s.ref.version });
        setResults(r.matches); setPick(r.matches.map(() => true));
        if (r.truncated) s.set({ notice: "Only the first 2000 matches are shown." });
      } catch (e) { s.set({ error: `Search failed: ${describeError(e)}` }); }
    } finally { setSearching(false); }
  };
  const chosen = results ? results.filter((_, i) => pick[i]) : [];
  return (
    <section aria-labelledby="rd-h" data-testid="redact-panel">
      <h2 id="rd-h" className="mb-1 flex items-center gap-1 font-semibold"><ShieldCheck aria-hidden className="h-4 w-4 text-[#E8141C]" />Redact</h2>
      <p className="mb-2 text-[11px] text-neutral-600 dark:text-neutral-400">Mark what to remove, review the list, then apply. Applying <strong>permanently deletes</strong> the text, images and graphics under each mark from the saved file — it is not a cover-up box.</p>
      {!gate.enabled && <p className="mb-2 text-xs text-neutral-500" data-testid="redact-reason">{gate.reason}</p>}
      <fieldset disabled={!gate.enabled} className="space-y-3 disabled:opacity-50">
        <RedactToolButtons />
        <div className="flex flex-wrap gap-1 text-xs">
          <button type="button" className="inline-flex items-center gap-1 rounded-md border border-neutral-300 px-2 py-1 hover:border-[#E8141C] dark:border-neutral-700" data-testid="redact-page"
            onClick={() => markWholePages([currentPage])}><FileX2 aria-hidden className="h-3.5 w-3.5" />Whole page {currentPage + 1}</button>
          <form className="flex items-center gap-1" onSubmit={(e) => { e.preventDefault(); const r = parseRanges(pages, pageSizes.length);
            if ("error" in r) { setPagesErr(r.error); return; } setPagesErr(null);
            markWholePages(r.ranges.flatMap(([a, b]) => Array.from({ length: b - a + 1 }, (_, i) => a - 1 + i))); setPages(""); }}>
            <input aria-label="Pages to redact entirely" placeholder="Pages e.g. 2-4" value={pages} onChange={(e) => setPages(e.target.value)} className="w-24 rounded border border-neutral-300 px-1 py-0.5 dark:border-neutral-700 dark:bg-neutral-800" />
            <button className="rounded border px-1.5 py-0.5 dark:border-neutral-700">Mark</button>
          </form>
          {pagesErr && <p className="w-full text-red-600">{pagesErr}</p>}
        </div>
        <div className="rounded border border-neutral-200 p-2 dark:border-neutral-800">
          <h3 className="mb-1 text-xs font-semibold">Find &amp; redact</h3>
          <form role="search" aria-label="Search the document for content to redact" onSubmit={(e) => { e.preventDefault(); void search(); }} className="space-y-1">
            <input aria-label="Text or pattern to redact" placeholder="Word, phrase or regex" value={q} onChange={(e) => setQ(e.target.value)}
              className="w-full rounded border border-neutral-300 bg-white px-2 py-1 text-xs dark:border-neutral-700 dark:bg-neutral-800" />
            <div className="flex flex-wrap gap-x-2 text-[11px]">
              <label><input type="checkbox" checked={cs} onChange={(e) => setCs(e.target.checked)} /> Match case</label>
              <label><input type="checkbox" checked={ww} onChange={(e) => setWw(e.target.checked)} /> Whole words</label>
              <label><input type="checkbox" checked={regex} onChange={(e) => setRegex(e.target.checked)} /> Regex</label>
            </div>
            <fieldset className="flex flex-wrap gap-x-2 text-[11px]"><legend className="sr-only">Patterns</legend>
              {(Object.keys(PATTERN_LABELS) as RedactPattern[]).map((p) => (
                <label key={p}><input type="checkbox" checked={pats.includes(p)} onChange={(e) => setPats(e.target.checked ? [...pats, p] : pats.filter((x) => x !== p))} /> {PATTERN_LABELS[p]}</label>))}
            </fieldset>
            <button className="rounded bg-ink px-2 py-1 text-xs text-white disabled:opacity-40 dark:bg-neutral-700" disabled={searching || (!q.trim() && !pats.length)} data-testid="redact-search">{searching ? "Searching…" : "Find"}</button>
          </form>
          {results && (
            <div className="mt-2 text-xs" data-testid="redact-results">
              <div className="flex items-center gap-2">
                <span>{results.length} match{results.length === 1 ? "" : "es"}</span>
                {results.length > 0 && <button className="ml-auto rounded bg-[#E8141C] px-2 py-0.5 text-white disabled:opacity-40" disabled={!chosen.length}
                  data-testid="redact-mark-results" onClick={() => { addMarks(matchesToMarks(chosen), `Mark ${chosen.length} search result${chosen.length === 1 ? "" : "s"}`); setResults(null); }}>Mark {chosen.length}</button>}
              </div>
              <ul className="mt-1 max-h-40 space-y-0.5 overflow-auto">
                {results.map((m, i) => (
                  <li key={i} className="flex items-center gap-1">
                    <input type="checkbox" aria-label={`Include “${m.text}” on page ${m.page}`} checked={!!pick[i]} onChange={(e) => setPick(pick.map((v, j) => (j === i ? e.target.checked : v)))} />
                    <button className="truncate text-left hover:underline" onClick={() => goToPage(m.page - 1)}>p{m.page} · {m.text}</button>
                  </li>))}
              </ul>
            </div>)}
        </div>
        <div>
          <div className="mb-1 flex items-center gap-2">
            <h3 className="text-xs font-semibold">Marked for redaction <span className="font-normal text-neutral-500" data-testid="redact-count">({marks.length})</span></h3>
            {selected.length > 0 && <button className="ml-auto inline-flex items-center gap-1 text-xs text-red-600 underline" onClick={() => removeMarks(selected, "Delete redaction marks")}><Trash2 aria-hidden className="h-3 w-3" />Delete selected</button>}
            {marks.length > 0 && !selected.length && <button className="ml-auto text-xs underline" onClick={() => clearMarks()}>Clear all</button>}
          </div>
          {marks.length === 0 ? <p className="text-xs text-neutral-500">No marks yet.</p> : (
            <ul className="max-h-48 space-y-0.5 overflow-auto text-xs" data-testid="redact-marks" aria-label="Redaction marks">
              {marks.map((m) => { const on = selected.includes(m.id); return (
                <li key={m.id} className={`flex items-center gap-1 rounded px-1 ${on ? "bg-[#E8141C]/10 ring-1 ring-[#E8141C]" : ""}`}>
                  <button className="min-w-0 flex-1 truncate text-left" aria-pressed={on}
                    onClick={(e) => { goToPage(m.page); const cur = useRedact.getState().selected; useRedact.getState().set({ selected: e.shiftKey || e.ctrlKey || e.metaKey ? (on ? cur.filter((i) => i !== m.id) : [...cur, m.id]) : [m.id] }); }}>
                    <span className="mr-1 rounded bg-ink px-1 text-[10px] text-white dark:bg-neutral-700">{m.kind}</span>p{m.page + 1} · {m.label}
                  </button>
                  <button aria-label={`Remove mark ${m.label}`} title="Remove mark" className="rounded p-0.5 hover:bg-neutral-200 dark:hover:bg-neutral-800" onClick={() => removeMarks([m.id])}><Trash2 aria-hidden className="h-3 w-3" /></button>
                </li>); })}
            </ul>)}
          {marks.length > 0 && <p className="mt-1 text-[11px] text-neutral-500">{summary(marks)} · Delete removes selected marks · Ctrl+Z undoes</p>}
        </div>
        <div className="flex flex-wrap gap-1">
          <button className="rounded bg-[#E8141C] px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-40" disabled={!marks.length || !!s.busy} onClick={() => setDialog(true)} data-testid="redact-apply">Apply redactions…</button>
          <button className="rounded border px-2 py-1.5 text-xs disabled:opacity-40 dark:border-neutral-700" disabled={!!s.busy} onClick={() => setDialog(true)} data-testid="redact-sanitize-only" title="Remove metadata, scripts, attachments, comments and other hidden content">{marks.length ? "Options…" : "Remove hidden information…"}</button>
        </div>
      </fieldset>
      {dialog && <RedactApplyDialog onClose={() => setDialog(false)} />}
    </section>
  );
}
