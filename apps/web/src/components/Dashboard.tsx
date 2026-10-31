"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { Wordmark } from "@thynkpdf/ui";
import type { DocumentInfo, VersionInfo, Folder } from "@thynkpdf/editor-client";
import { useSession } from "@/lib/session";
import { bootstrapAuth, describeError, http } from "@/lib/documents";
import { toQuery, parseTags, type SortKey, type View } from "@/lib/docFilter";
import { SignInForm } from "./SignInForm";
import { SharePanel } from "./SharePanel";

const utc = (s: string) => new Date(s + (/[zZ]|[+-]\d\d:?\d\d$/.test(s) ? "" : "Z"));
const btn = "rounded border px-2 py-1 text-xs dark:border-neutral-700";

export function Dashboard() {
  const s = useSession();
  const [docs, setDocs] = useState<DocumentInfo[] | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [q, setQ] = useState(""); const [sort, setSort] = useState<SortKey>("updated_desc");
  const [view, setView] = useState<View>({ kind: "all" });
  const [folders, setFolders] = useState<Folder[]>([]); const [tags, setTags] = useState<string[]>([]);
  const [open, setOpen] = useState<{ id: string; panel: "versions" | "share" | "tags" | "move" | "delete" | "rename" } | null>(null);
  const [versions, setVersions] = useState<VersionInfo[] | null>(null);
  const [uploading, setUploading] = useState<string | null>(null);
  const [newFolder, setNewFolder] = useState(""); const [tagInput, setTagInput] = useState("");
  const [nameInput, setNameInput] = useState(""); const [renamingFolder, setRenamingFolder] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const isHttp = s.api.kind === "http";

  useEffect(() => {
    void bootstrapAuth();
    s.api.health().then((ok) => s.set({ backend: ok ? "online" : "offline" }));
  }, [s.api]); // eslint-disable-line react-hooks/exhaustive-deps
  const loadSide = useCallback(async () => {
    if (!isHttp) return;
    try { const [f, t] = await Promise.all([http().listFolders(), http().listTags()]); setFolders(f); setTags(t); } catch (e) { setErr(describeError(e)); }
  }, [isHttp]);
  const refresh = useCallback(async (more = false) => {
    try {
      const page = await s.api.listDocuments(toQuery(view, q, sort, more ? cursor ?? undefined : undefined));
      setDocs((prev) => (more && prev ? [...prev, ...page.items] : page.items)); setCursor(page.next_cursor); setErr(null);
    } catch (e) { setErr(describeError(e)); }
  }, [s.api, view, q, sort, cursor]);
  // Debounced server-side search / view / sort.
  useEffect(() => { if (!s.authed) return; const t = setTimeout(() => void refresh(false), 200); return () => clearTimeout(t); }, [s.authed, view, q, sort]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (s.authed) void loadSide(); }, [s.authed, loadSide]);
  useEffect(() => {
    setVersions(null);
    if (open?.panel === "versions") s.api.listVersions(open.id).then(setVersions, (e) => setErr(describeError(e)));
  }, [open, s.api]);

  const act = async (label: string, fn: () => Promise<unknown>) => {
    setErr(null); setMsg(null);
    try { await fn(); setMsg(label); await refresh(false); await loadSide(); } catch (e) { setErr(describeError(e)); }
  };
  const upload = async (files: FileList | null) => {
    if (!files?.length) return;
    for (const f of Array.from(files)) {
      setUploading(`Uploading ${f.name}…`);
      try {
        const up = await s.api.upload(f, f.name);
        if (view.kind === "folder" && view.id !== "root" && isHttp) await http().patchDocument(up.document_id, { folder_id: view.id });
      } catch (e) { setErr(`${f.name}: ${describeError(e)}`); }
    }
    setUploading(null); void refresh(false); void loadSide();
  };
  const navBtn = (label: string, v: View, key: string) => {
    const cur = JSON.stringify(v) === JSON.stringify(view);
    return <button key={key} onClick={() => { setView(v); setOpen(null); }} aria-current={cur ? "page" : undefined}
      className={`rounded px-2 py-1 text-left ${cur ? "bg-neutral-100 dark:bg-neutral-800" : ""}`}>{label}</button>;
  };
  const trash = view.kind === "trash";

  return (
    <div className="flex min-h-screen flex-col" onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); if (s.authed && !trash) void upload(e.dataTransfer.files); }}>
      <header className="flex h-12 items-center gap-3 border-b px-4 dark:border-neutral-800">
        <a href="/" aria-label="THYNKPDF editor"><Wordmark /></a>
        <h1 className="text-sm font-semibold">Documents</h1>
        <a href="/" className="ml-auto text-sm underline">Open editor</a>
      </header>
      <div className="flex min-h-0 flex-1 flex-col md:flex-row">
        <nav aria-label="Document locations" className="flex shrink-0 flex-wrap gap-1 border-b p-2 text-sm md:w-52 md:flex-col md:flex-nowrap md:border-b-0 md:border-r dark:border-neutral-800">
          {navBtn("All documents", { kind: "all" }, "all")}
          {navBtn("Starred", { kind: "starred" }, "starred")}
          {navBtn("Trash", { kind: "trash" }, "trash")}
          {s.authed && isHttp && (<>
            <p className="mt-2 w-full px-2 text-xs font-semibold text-neutral-500">Folders</p>
            {navBtn("Unfiled", { kind: "folder", id: "root" }, "root")}
            {folders.map((f) => renamingFolder === f.folder_id ? (
              <form key={f.folder_id} className="flex gap-1 px-1" onSubmit={(e) => { e.preventDefault(); const n = nameInput.trim(); if (n) void act(`Renamed folder to ${n}`, () => http().renameFolder(f.folder_id, n)).then(() => setRenamingFolder(null)); }}>
                <input aria-label={`New name for folder ${f.name}`} value={nameInput} onChange={(e) => setNameInput(e.target.value)} className="w-28 rounded border px-1 text-xs dark:border-neutral-700 dark:bg-neutral-800" />
                <button className={btn}>Save</button><button type="button" className="text-xs" aria-label="Cancel rename" onClick={() => setRenamingFolder(null)}>✕</button>
              </form>) : <span key={f.folder_id} className="flex items-center">{navBtn(f.name, { kind: "folder", id: f.folder_id }, f.folder_id)}
              <button aria-label={`Rename folder ${f.name}`} title="Rename folder" className="ml-auto px-1 text-xs text-neutral-500" onClick={() => { setRenamingFolder(f.folder_id); setNameInput(f.name); }}>✎</button>
              <button aria-label={`Delete folder ${f.name}`} title="Delete folder (must be empty)" className="px-1 text-xs text-neutral-500" onClick={() => act(`Deleted folder ${f.name}`, () => http().deleteFolder(f.folder_id))}>×</button></span>)}
            <form className="flex gap-1 px-1" onSubmit={(e) => { e.preventDefault(); if (newFolder.trim()) void act(`Created folder ${newFolder}`, () => http().createFolder(newFolder.trim())).then(() => setNewFolder("")); }}>
              <input aria-label="New folder name" placeholder="New folder" value={newFolder} onChange={(e) => setNewFolder(e.target.value)} className="w-28 rounded border px-1 text-xs dark:border-neutral-700 dark:bg-neutral-800" />
              <button className={btn}>Add</button>
            </form>
            {tags.length > 0 && <p className="mt-2 w-full px-2 text-xs font-semibold text-neutral-500">Tags</p>}
            {tags.map((t) => navBtn(`#${t}`, { kind: "tag", tag: t }, "tag-" + t))}
          </>)}
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
                <input type="search" aria-label="Search documents" placeholder="Search by name" value={q} onChange={(e) => setQ(e.target.value)}
                  className="w-56 rounded border px-2 py-1 text-sm dark:border-neutral-700 dark:bg-neutral-800" />
                <select aria-label="Sort" value={sort} onChange={(e) => setSort(e.target.value as SortKey)} className="rounded border px-1 py-1 text-sm dark:border-neutral-700 dark:bg-neutral-800">
                  <option value="updated_desc">Recently updated</option><option value="created_desc">Newest</option><option value="created_asc">Oldest</option><option value="name_asc">Name A–Z</option><option value="name_desc">Name Z–A</option>
                </select>
                {!trash && <button className="rounded bg-brand-600 px-3 py-1 text-sm text-white" onClick={() => fileRef.current?.click()}>Upload PDFs</button>}
                <input ref={fileRef} type="file" multiple accept="application/pdf,.pdf" hidden data-testid="dash-file-input" onChange={(e) => { void upload(e.target.files); e.target.value = ""; }} />
                <span className="text-xs text-neutral-500" role="status">{uploading ?? msg ?? (docs ? `${docs.length}${cursor ? "+" : ""} documents` : "Loading…")}</span>
              </div>
              {err && <p role="alert" className="mb-2 text-sm text-red-600">{err}</p>}
              <table className="w-full text-left text-sm" data-testid="doc-table">
                <thead className="text-xs text-neutral-500"><tr><th className="py-1">Name</th><th className="hidden sm:table-cell">Version</th><th className="hidden sm:table-cell">Updated</th><th><span className="sr-only">Actions</span></th></tr></thead>
                <tbody>
                  {(docs ?? []).map((d) => {
                    const p = open?.id === d.document_id ? open.panel : null;
                    const toggle = (panel: NonNullable<typeof open>["panel"]) => { setOpen(p === panel ? null : { id: d.document_id, panel }); setTagInput(d.tags.join(", ")); setNameInput(d.filename); };
                    return (
                    <tr key={d.document_id} className="border-t align-top dark:border-neutral-800" data-testid="doc-row">
                      <td className="py-2">
                        {trash ? <span className="font-medium">{d.filename}</span> : <a className="font-medium hover:underline" href={`/?doc=${d.document_id}`}>{d.filename}</a>}
                        {d.starred && <span className="ml-1 text-amber-600" aria-label="starred">★</span>}
                        {d.tags.map((t) => <span key={t} className="ml-1 rounded bg-neutral-100 px-1 text-xs dark:bg-neutral-800">#{t}</span>)}
                        {p === "versions" && (
                          <div className="mt-2 rounded border p-2 text-xs dark:border-neutral-700" data-testid="versions">
                            <p className="mb-1 font-semibold">Version history</p>
                            {!versions ? "Loading…" : (
                              <ol className="space-y-1">
                                {[...versions].sort((a, b) => b.number - a.number).map((v) => (
                                  <li key={v.version_id} className="flex flex-wrap gap-2">
                                    <span>v{v.number}</span><span className="text-neutral-500">{v.operation}</span>
                                    <span className="text-neutral-500">{utc(v.created_at).toLocaleString()}</span>
                                    <a className="underline" href={v.number === d.current_version ? `/?doc=${d.document_id}` : `/?doc=${d.document_id}&version=${v.version_id}&n=${v.number}`}>{v.number === d.current_version ? "Open (current)" : "View (read-only)"}</a>
                                    {v.number !== d.current_version && isHttp && !trash && (
                                      <button className="underline" onClick={() => act(`Restored v${v.number} as a new version`, async () => {
                                        await http().restoreVersion({ document_id: d.document_id, version_id: d.version_id, version: d.current_version }, v.version_id);
                                        setOpen(null);
                                      })}>Restore as new version</button>)}
                                  </li>))}
                              </ol>)}
                          </div>)}
                        {p === "tags" && (
                          <form className="mt-2 flex gap-1" onSubmit={(e) => { e.preventDefault(); void act("Tags saved", () => http().patchDocument(d.document_id, { tags: parseTags(tagInput) })).then(() => setOpen(null)); }}>
                            <input aria-label={`Tags for ${d.filename}`} value={tagInput} onChange={(e) => setTagInput(e.target.value)} placeholder="tax, 2026" className="w-48 rounded border px-1 text-xs dark:border-neutral-700 dark:bg-neutral-800" />
                            <button className={btn}>Save tags</button><span className="text-xs text-neutral-500">a–z, 0–9, _ and - only</span>
                          </form>)}
                        {p === "rename" && (
                          <form className="mt-2 flex gap-1" onSubmit={(e) => { e.preventDefault(); const n = nameInput.trim(); if (n) void act(`Renamed to ${/\.pdf$/i.test(n) ? n : n + ".pdf"}`, () => http().patchDocument(d.document_id, { filename: /\.pdf$/i.test(n) ? n : `${n}.pdf` })).then(() => setOpen(null)); }}>
                            <input aria-label={`New name for ${d.filename}`} value={nameInput} onChange={(e) => setNameInput(e.target.value)} className="w-56 rounded border px-1 text-xs dark:border-neutral-700 dark:bg-neutral-800" />
                            <button className={btn}>Save name</button>
                          </form>)}
                        {p === "move" && (
                          <div className="mt-2 flex flex-wrap gap-1 text-xs">
                            <span>Move to:</span>
                            {[{ folder_id: "root", name: "Unfiled" }, ...folders].map((f) => (
                              <button key={f.folder_id} className={btn} disabled={(d.folder_id ?? "root") === f.folder_id} onClick={() => act(`Moved to ${f.name}`, () => http().patchDocument(d.document_id, { folder_id: f.folder_id })).then(() => setOpen(null))}>{f.name}</button>))}
                          </div>)}
                        {p === "share" && <SharePanel doc={d} onError={setErr} />}
                        {p === "delete" && (
                          <div role="alertdialog" aria-label="Confirm permanent deletion" className="mt-2 rounded border border-red-300 p-2 text-xs">
                            <p>Permanently delete <b>{d.filename}</b>? All stored versions are destroyed and this cannot be undone (the audit trail is kept).</p>
                            <button className="mt-1 rounded bg-red-600 px-2 py-1 text-white" onClick={() => act(`Deleted ${d.filename} permanently`, () => http().deletePermanently(d.document_id)).then(() => setOpen(null))}>Delete forever</button>
                            <button className={`${btn} ml-1`} onClick={() => setOpen(null)}>Cancel</button>
                          </div>)}
                      </td>
                      <td className="hidden sm:table-cell">v{d.current_version}</td>
                      <td className="hidden sm:table-cell">{utc(d.updated_at ?? d.created_at).toLocaleDateString()}</td>
                      <td className="space-x-1 whitespace-nowrap text-right">
                        {trash ? (<>
                          <button className={btn} onClick={() => act(`Restored ${d.filename}`, () => http().restoreDocument(d.document_id))}>Restore</button>
                          <button className={btn} aria-expanded={p === "delete"} onClick={() => toggle("delete")}>Delete forever</button>
                        </>) : (<>
                          <button className={btn} aria-expanded={p === "versions"} onClick={() => toggle("versions")}>Versions</button>
                          {isHttp && <>
                            <button className={btn} aria-pressed={d.starred} aria-label={`${d.starred ? "Unstar" : "Star"} ${d.filename}`} onClick={() => act(d.starred ? "Unstarred" : "Starred", () => http().patchDocument(d.document_id, { starred: !d.starred }))}>{d.starred ? "Unstar" : "Star"}</button>
                            <button className={btn} aria-expanded={p === "rename"} onClick={() => toggle("rename")}>Rename</button>
                            <button className={btn} aria-expanded={p === "tags"} onClick={() => toggle("tags")}>Tags</button>
                            <button className={btn} aria-expanded={p === "move"} onClick={() => toggle("move")}>Move</button>
                            <button className={btn} aria-expanded={p === "share"} onClick={() => toggle("share")}>Share</button>
                            <button className={btn} aria-label={`Move ${d.filename} to trash`} onClick={() => act(`Moved ${d.filename} to trash`, () => http().trashDocument(d.document_id))}>Trash</button>
                          </>}
                        </>)}
                      </td>
                    </tr>);
                  })}
                </tbody>
              </table>
              {docs && docs.length === 0 && <p className="mt-3 text-sm text-neutral-500">{trash ? "Trash is empty." : "No documents here yet."}</p>}
              {cursor && <button className={`${btn} mt-3`} onClick={() => void refresh(true)}>Load more</button>}
            </>
          )}
        </main>
      </div>
    </div>
  );
}
