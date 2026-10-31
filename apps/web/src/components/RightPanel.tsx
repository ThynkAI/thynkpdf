"use client";
import { forwardRef, useState } from "react";
import { useViewerStore } from "@thynkpdf/pdf-viewer";
import { useSession } from "@/lib/session";

export const RightPanel = forwardRef<HTMLInputElement>(function RightPanel(_p, searchRef) {
  const { query, setQuery, matches, activeMatch, nextMatch, pagesText, goToPage, fileName, pageSizes } = useViewerStore();
  const [q, setQ] = useState(query);
  const s = useSession();
  const [user, setUser] = useState(""); const [pw, setPw] = useState("");
  const textReady = pagesText.length > 0 && pagesText.every((t) => t !== null);
  const perPage = new Map<number, number>();
  matches.forEach((m) => perPage.set(m.page, (perPage.get(m.page) ?? 0) + 1));
  return (
    <aside aria-label="Right panel" className="flex h-full w-72 flex-col gap-4 overflow-auto border-l border-neutral-200 bg-neutral-50 p-3 text-sm dark:border-neutral-800 dark:bg-neutral-900">
      <section>
        <h2 className="mb-2 font-semibold">Search</h2>
        <form role="search" onSubmit={(e) => { e.preventDefault(); if (q === query && matches.length) nextMatch(1); else setQuery(q); }}>
          <input ref={searchRef} aria-label="Search document" placeholder="Find in document" value={q} onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && e.shiftKey) { e.preventDefault(); nextMatch(-1); } }}
            className="w-full rounded border border-neutral-300 bg-white px-2 py-1 dark:border-neutral-700 dark:bg-neutral-800" />
        </form>
        <div className="mt-2 flex items-center gap-2 text-xs text-neutral-500">
          <span data-testid="search-count">{!pageSizes.length ? "No document" : !textReady ? "Indexing text…" : query ? `${matches.length ? activeMatch + 1 : 0} of ${matches.length} matches` : "Enter a term"}</span>
          <button className="ml-auto underline disabled:opacity-40" disabled={!matches.length} onClick={() => nextMatch(-1)}>Prev</button>
          <button className="underline disabled:opacity-40" disabled={!matches.length} onClick={() => nextMatch(1)}>Next</button>
        </div>
        <ul className="mt-2 space-y-1">
          {[...perPage].map(([p, c]) => (
            <li key={p}><button className="w-full rounded px-2 py-1 text-left hover:bg-neutral-200 dark:hover:bg-neutral-800" onClick={() => goToPage(p)}>Page {p + 1} — {c} match{c > 1 ? "es" : ""}</button></li>
          ))}
        </ul>
      </section>
      <section>
        <h2 className="mb-2 font-semibold">Document</h2>
        <dl className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-1 text-xs">
          <dt className="text-neutral-500">Name</dt><dd className="truncate">{fileName ?? "—"}</dd>
          <dt className="text-neutral-500">Pages</dt><dd>{pageSizes.length || "—"}</dd>
          <dt className="text-neutral-500">Version</dt><dd className="truncate" data-testid="version-id">{s.ref?.version_id ?? "local only"}</dd>
        </dl>
      </section>
      <section>
        <h2 className="mb-2 font-semibold">Backend</h2>
        <p className="text-xs" data-testid="backend-status">{s.api.kind === "mock" ? "Mock API (in-browser, not persisted)" : s.backend === "online" ? (s.authed ? "Connected" : "Online — sign in to upload") : s.backend === "offline" ? "Offline — files open locally" : "Checking…"}</p>
        {s.api.kind === "http" && s.backend === "online" && !s.authed && (
          <form className="mt-2 space-y-1" onSubmit={async (e) => { e.preventDefault(); try { await s.api.login(user, pw); s.set({ authed: true, error: null }); } catch (err) { s.set({ error: (err as Error).message }); } }}>
            <input aria-label="Username" placeholder="Email" value={user} onChange={(e) => setUser(e.target.value)} className="w-full rounded border px-2 py-1 dark:bg-neutral-800" />
            <input aria-label="Password" type="password" placeholder="Password" value={pw} onChange={(e) => setPw(e.target.value)} className="w-full rounded border px-2 py-1 dark:bg-neutral-800" />
            <button className="rounded bg-brand-600 px-3 py-1 text-white">Sign in</button>
          </form>
        )}
      </section>
    </aside>
  );
});
