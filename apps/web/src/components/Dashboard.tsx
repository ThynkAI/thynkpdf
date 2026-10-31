"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { Wordmark } from "@thynkpdf/ui";
import type { DocumentInfo, VersionInfo } from "@thynkpdf/editor-client";
import { useSession } from "@/lib/session";
import { bootstrapAuth, describeError } from "@/lib/documents";
import { filterDocs, type SortKey } from "@/lib/docFilter";
import { SignInForm } from "./SignInForm";

const BLOCKED = "Needs backend support (see apps/web/docs/frontend-backend-requests.md §5)";

export function Dashboard() {
  const s = useSession();
  const [docs, setDocs] = useState<DocumentInfo[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [q, setQ] = useState(""); const [sort, setSort] = useState<SortKey>("created_desc");
  const [open, setOpen] = useState<string | null>(null);
  const [versions, setVersions] = useState<VersionInfo[] | null>(null);
  const [uploading, setUploading] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    bootstrapAuth();
    s.api.health().then((ok) => s.set({ backend: ok ? "online" : "offline" }));
  }, [s.api]); // eslint-disable-line react-hooks/exhaustive-deps
  const refresh = useCallback(async () => {
    try { setDocs(await s.api.listDocuments()); setErr(null); } catch (e) { setErr(describeError(e)); }
  }, [s.api]);
  useEffect(() => { if (s.authed) void refresh(); }, [s.authed, refresh]);
  useEffect(() => {
    setVersions(null);
    if (open) s.api.listVersions(open).then(setVersions, (e) => setErr(describeError(e)));
  }, [open, s.api]);

  const upload = async (files: FileList | null) => {
    if (!files?.length) return;
    for (const f of Array.from(files)) {
      setUploading(`Uploading ${f.name}…`);
      try { await s.api.upload(f, f.name); } catch (e) { setErr(`${f.name}: ${describeError(e)}`); }
    }
    setUploading(null); void refresh();
  };
  const list = docs ? filterDocs(docs, q, sort) : [];
  const disabledBtn = "rounded border px-2 py-1 text-xs opacity-40 dark:border-neutral-700";

  return (
    <div className="flex min-h-screen flex-col" onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); if (s.authed) void upload(e.dataTransfer.files); }}>
      <header className="flex h-12 items-center gap-3 border-b px-4 dark:border-neutral-800">
        <a href="/" aria-label="THYNKPDF editor"><Wordmark /></a>
        <h1 className="text-sm font-semibold">Documents</h1>
        <a href="/" className="ml-auto text-sm underline">Open editor</a>
      </header>
      <div className="flex min-h-0 flex-1 flex-col md:flex-row">
        <nav aria-label="Document locations" className="flex shrink-0 gap-1 border-b p-2 text-sm md:w-48 md:flex-col md:border-b-0 md:border-r dark:border-neutral-800">
          <button className="rounded bg-neutral-100 px-2 py-1 text-left dark:bg-neutral-800" aria-current="page">All documents</button>
          {["Folders", "Starred", "Shared with me", "Trash"].map((l) => (
            <button key={l} disabled title={BLOCKED} aria-label={`${l} (unavailable: backend support missing)`} className="rounded px-2 py-1 text-left opacity-40">{l}</button>
          ))}
        </nav>
        <main className="min-w-0 flex-1 p-4">
          {!s.authed ? (
            <section className="max-w-sm">
              <p className="text-sm" data-testid="dash-backend">{s.backend === "offline" ? "The THYNKPDF server is offline. You can still open files locally in the editor." : "Sign in to see your documents."}</p>
              {s.backend === "online" && <SignInForm />}
            </section>
          ) : (
            <>
              <div className="mb-3 flex flex-wrap items-center gap-2">
                <input type="search" aria-label="Filter documents by name" placeholder="Filter by name" value={q} onChange={(e) => setQ(e.target.value)}
                  className="w-56 rounded border px-2 py-1 text-sm dark:border-neutral-700 dark:bg-neutral-800" />
                <select aria-label="Sort" value={sort} onChange={(e) => setSort(e.target.value as SortKey)} className="rounded border px-1 py-1 text-sm dark:border-neutral-700 dark:bg-neutral-800">
                  <option value="created_desc">Newest</option><option value="created_asc">Oldest</option><option value="name_asc">Name A–Z</option><option value="name_desc">Name Z–A</option>
                </select>
                <button className="rounded bg-brand-600 px-3 py-1 text-sm text-white" onClick={() => fileRef.current?.click()}>Upload PDFs</button>
                <input ref={fileRef} type="file" multiple accept="application/pdf,.pdf" hidden data-testid="dash-file-input" onChange={(e) => { void upload(e.target.files); e.target.value = ""; }} />
                <span className="text-xs text-neutral-500" role="status">{uploading ?? (docs ? `${list.length} of ${docs.length} documents` : "Loading…")}</span>
              </div>
              {err && <p role="alert" className="mb-2 text-sm text-red-600">{err}</p>}
              <table className="w-full text-left text-sm" data-testid="doc-table">
                <thead className="text-xs text-neutral-500"><tr><th className="py-1">Name</th><th className="hidden sm:table-cell">Version</th><th className="hidden sm:table-cell">Created</th><th><span className="sr-only">Actions</span></th></tr></thead>
                <tbody>
                  {list.map((d) => (
                    <tr key={d.document_id} className="border-t align-top dark:border-neutral-800">
                      <td className="py-2"><a className="font-medium hover:underline" href={`/?doc=${d.document_id}`}>{d.filename}</a>
                        {open === d.document_id && (
                          <div className="mt-2 rounded border p-2 text-xs dark:border-neutral-700" data-testid="versions">
                            <p className="mb-1 font-semibold">Version history</p>
                            {!versions ? "Loading…" : (
                              <ol className="space-y-1">
                                {[...versions].sort((a, b) => b.number - a.number).map((v) => (
                                  <li key={v.version_id} className="flex flex-wrap gap-2">
                                    <span>v{v.number}</span><span className="text-neutral-500">{v.operation}</span>
                                    <span className="text-neutral-500">{new Date(v.created_at + (v.created_at.endsWith("Z") ? "" : "Z")).toLocaleString()}</span>
                                    <a className="underline" href={v.number === d.current_version ? `/?doc=${d.document_id}` : `/?doc=${d.document_id}&version=${v.version_id}&n=${v.number}`}>{v.number === d.current_version ? "Open (current)" : "View (read-only)"}</a>
                                  </li>))}
                              </ol>)}
                            <button disabled title={BLOCKED} className="mt-1 underline opacity-40">Restore older version (unavailable)</button>
                          </div>)}
                      </td>
                      <td className="hidden sm:table-cell">v{d.current_version}</td>
                      <td className="hidden sm:table-cell">{new Date(d.created_at + (d.created_at.endsWith("Z") ? "" : "Z")).toLocaleDateString()}</td>
                      <td className="space-x-1 whitespace-nowrap text-right">
                        <button className="rounded border px-2 py-1 text-xs dark:border-neutral-700" aria-expanded={open === d.document_id} onClick={() => setOpen(open === d.document_id ? null : d.document_id)}>Versions</button>
                        {["Star", "Tag", "Share", "Move", "Trash"].map((l) => <button key={l} disabled title={BLOCKED} aria-label={`${l} ${d.filename} (unavailable)`} className={disabledBtn}>{l}</button>)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </main>
      </div>
    </div>
  );
}
