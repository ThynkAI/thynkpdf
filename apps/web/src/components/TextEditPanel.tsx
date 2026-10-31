"use client";
import { useState } from "react";
import { useViewerStore } from "@thynkpdf/pdf-viewer";
import { useSession } from "@/lib/session";
import { replaceText } from "@/lib/documents";
import { textEditGate } from "@/lib/gates";

/** Find/replace text on the current page via the backend's content-stream rewrite. Shows per-page limitations from /capabilities. */
export function TextEditPanel() {
  const page = useViewerStore((s) => s.currentPage) + 1;
  const { ref, caps, busy, capsError } = useSession();
  const [find, setFind] = useState("");
  const [rep, setRep] = useState("");
  const [occ, setOcc] = useState<"all" | "first">("all");
  const [result, setResult] = useState<string | null>(null);
  const gate = textEditGate(page, ref, caps, { busy: !!busy, capsError });
  const pageCaps = caps?.pages.find((p) => p.number === page);
  return (
    <section aria-labelledby="te-h">
      <h2 id="te-h" className="mb-2 font-semibold">Edit text — page {page}</h2>
      {pageCaps && pageCaps.limitations.length > 0 && (
        <ul className="mb-2 space-y-1 text-xs text-amber-700 dark:text-amber-400" data-testid="page-limitations">
          {pageCaps.limitations.map((l, i) => <li key={i}><b>{l.code}</b>{l.font ? ` (${l.font})` : ""}: {l.message}</li>)}
        </ul>
      )}
      {!gate.enabled && <p className="mb-2 text-xs text-neutral-500" data-testid="text-edit-reason">{gate.reason}</p>}
      <form className="space-y-1" onSubmit={async (e) => {
        e.preventDefault(); setResult(null);
        const n = await replaceText(page, find, rep, occ);
        if (n !== null) setResult(`Replaced ${n} occurrence${n === 1 ? "" : "s"} on page ${page}.`);
      }}>
        <div className="flex gap-1">
          <input aria-label="Find text" placeholder="Find (exact)" value={find} onChange={(e) => setFind(e.target.value)} disabled={!gate.enabled}
            className="min-w-0 flex-1 rounded border border-neutral-300 bg-white px-2 py-1 dark:border-neutral-700 dark:bg-neutral-800" />
          <button type="button" className="rounded border px-2 text-xs disabled:opacity-40" disabled={!gate.enabled}
            onClick={() => setFind(window.getSelection()?.toString().trim() ?? "")} title="Use text selected in the page">Use selection</button>
        </div>
        <input aria-label="Replacement text" placeholder="Replace with" value={rep} onChange={(e) => setRep(e.target.value)} disabled={!gate.enabled}
          className="w-full rounded border border-neutral-300 bg-white px-2 py-1 dark:border-neutral-700 dark:bg-neutral-800" />
        <div className="flex items-center gap-2 text-xs">
          <label><input type="radio" name="occ" checked={occ === "all"} onChange={() => setOcc("all")} /> All</label>
          <label><input type="radio" name="occ" checked={occ === "first"} onChange={() => setOcc("first")} /> First</label>
          <button className="ml-auto rounded bg-brand-600 px-3 py-1 text-white disabled:opacity-40" disabled={!gate.enabled || !find}>Replace</button>
        </div>
        {result && <p className="text-xs text-green-700 dark:text-green-400" data-testid="text-edit-result">{result}</p>}
        <p className="text-[11px] text-neutral-500">Edits rewrite the page&apos;s text in place (no overlay). Only text drawn in one run with a standard font can be changed.</p>
      </form>
    </section>
  );
}
