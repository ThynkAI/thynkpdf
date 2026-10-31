"use client";
import { forwardRef, useState } from "react";
import { useViewerStore } from "@thynkpdf/pdf-viewer";
import { useSession } from "@/lib/session";
import { editGate } from "@/lib/gates";
import { signOut, ensureText } from "@/lib/documents";
import { TextEditPanel } from "./TextEditPanel";
import { SignInForm } from "./SignInForm";
import { SignPanel } from "./SignPanel";
import { CommentsPanel } from "./CommentsPanel";
import { FormsPanel } from "./FormsPanel";
import { AiPanel } from "./AiPanel";

export const RightPanel = forwardRef<HTMLInputElement, { onClose?: () => void }>(function RightPanel({ onClose }, searchRef) {
  const { query, setQuery, matches, activeMatch, nextMatch, pagesText, goToPage, fileName, pageSizes } = useViewerStore();
  const [q, setQ] = useState(query);
  const s = useSession();
  const textReady = pagesText.length > 0 && pagesText.every((t) => t !== null);
  const perPage = new Map<number, number>();
  matches.forEach((m) => perPage.set(m.page, (perPage.get(m.page) ?? 0) + 1));
  return (
    <aside aria-label="Right panel" className="absolute inset-y-0 right-0 z-20 flex h-full w-[min(18rem,100%)] flex-col gap-4 overflow-auto border-l shadow-lg lg:static lg:w-72 lg:shadow-none border-neutral-200 bg-neutral-50 p-3 text-sm dark:border-neutral-800 dark:bg-neutral-900">
      {onClose && <button className="self-end rounded px-2 text-xs underline lg:hidden" onClick={onClose} aria-label="Close panel">Close</button>}
      <section>
        <h2 className="mb-2 font-semibold">Search</h2>
        <form role="search" onSubmit={(e) => { e.preventDefault(); if (q === query && matches.length) nextMatch(1); else { setQuery(q); void ensureText(); } }}>
          <input ref={searchRef} aria-label="Search document" placeholder="Find in document" value={q} onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && e.shiftKey) { e.preventDefault(); nextMatch(-1); } }}
            className="w-full rounded border border-neutral-300 bg-white px-2 py-1 dark:border-neutral-700 dark:bg-neutral-800" />
        </form>
        <div className="mt-2 flex items-center gap-2 text-xs text-neutral-500">
          <span data-testid="search-count">{!pageSizes.length ? "No document" : query && !textReady ? "Indexing text…" : query ? `${matches.length ? activeMatch + 1 : 0} of ${matches.length} matches` : "Enter a term"}</span>
          <button className="ml-auto underline disabled:opacity-40" disabled={!matches.length} onClick={() => nextMatch(-1)}>Prev</button>
          <button className="underline disabled:opacity-40" disabled={!matches.length} onClick={() => nextMatch(1)}>Next</button>
        </div>
        <ul className="mt-2 space-y-1">
          {[...perPage].map(([p, c]) => (
            <li key={p}><button className="w-full rounded px-2 py-1 text-left hover:bg-neutral-200 dark:hover:bg-neutral-800" onClick={() => goToPage(p)}>Page {p + 1} — {c} match{c > 1 ? "es" : ""}</button></li>
          ))}
        </ul>
      </section>
      <CommentsPanel />
      <TextEditPanel />
      <SignPanel />
      <FormsPanel />
      {s.api.kind === "http" && <AiPanel />}
      <section>
        <h2 className="mb-2 font-semibold">Document</h2>
        <dl className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-1 text-xs">
          <dt className="text-neutral-500">Name</dt><dd className="truncate">{fileName ?? "—"}</dd>
          <dt className="text-neutral-500">Pages</dt><dd>{pageSizes.length || "—"}</dd>
          <dt className="text-neutral-500">Version</dt><dd className="truncate" data-testid="version-id">{s.ref ? `v${s.ref.version} (${s.ref.version_id.slice(0, 8)})` : "local only"}</dd>
        </dl>
      </section>
      <section>
        <h2 className="mb-2 font-semibold">Editing</h2>
        <ul className="space-y-1 text-xs" data-testid="edit-gates">
          {(["rotate", "reorder", "delete", "duplicate", "insert_blank"] as const).map((a) => { const g = editGate(a, s.ref, s.caps, { capsError: s.capsError }); return (
            <li key={a}><span className={g.enabled ? "text-green-700 dark:text-green-400" : "text-neutral-500"}>{({ rotate: "Rotate pages", reorder: "Reorder pages (drag thumbnails)", delete: "Delete pages", duplicate: "Duplicate pages", insert_blank: "Insert pages" } as const)[a]}: {g.enabled ? "available" : g.reason}</span></li>); })}
          {s.caps?.document_limitations.map((l) => <li key={l.code} className="text-amber-700">{l.code}: {l.message}</li>)}
        </ul>
      </section>
      <section>
        <h2 className="mb-2 font-semibold">Backend</h2>
        <p className="text-xs" data-testid="backend-status">{s.api.kind === "mock" ? "Mock API (in-browser, not persisted)" : s.backend === "online" ? (s.authed ? "Connected" : "Online — sign in to upload") : s.backend === "offline" ? "Offline — files open locally" : "Checking…"}</p>
        {s.api.kind === "http" && s.authed && <button className="mt-1 text-xs underline" onClick={() => void signOut()}>Sign out</button>}
        {s.api.kind === "http" && s.backend === "online" && !s.authed && (
          <SignInForm />
        )}
      </section>
    </aside>
  );
});
