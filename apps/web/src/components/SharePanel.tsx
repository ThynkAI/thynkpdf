"use client";
import { useEffect, useState } from "react";
import type { DocumentInfo, Share } from "@thynkpdf/editor-client";
import { describeError, http } from "@/lib/documents";

const btn = "rounded border px-2 py-1 text-xs dark:border-neutral-700";

/** Sharing: org-member grants (viewer/editor) and public VIEW-ONLY links. A link URL is returned once by the server. */
export function SharePanel({ doc, onError }: { doc: DocumentInfo; onError: (m: string | null) => void }) {
  const [shares, setShares] = useState<Share[] | null>(null);
  const [email, setEmail] = useState(""); const [role, setRole] = useState<"viewer" | "editor">("viewer");
  const [link, setLink] = useState<string | null>(null);
  const load = () => http().listShares(doc.document_id).then(setShares, (e) => onError(describeError(e)));
  useEffect(() => { void load(); }, [doc.document_id]); // eslint-disable-line react-hooks/exhaustive-deps
  const run = async (fn: () => Promise<unknown>) => { onError(null); try { await fn(); await load(); } catch (e) { onError(describeError(e)); } };
  return (
    <div className="mt-2 space-y-2 rounded border p-2 text-xs dark:border-neutral-700" data-testid="share-panel">
      <form className="flex flex-wrap items-center gap-1" onSubmit={(e) => { e.preventDefault(); void run(() => http().createShare(doc.document_id, { email: email.trim(), role })).then(() => setEmail("")); }}>
        <input aria-label="Share with (org member email)" type="email" required placeholder="teammate@your-org" value={email} onChange={(e) => setEmail(e.target.value)} className="w-48 rounded border px-1 dark:border-neutral-700 dark:bg-neutral-800" />
        <select aria-label="Role" value={role} onChange={(e) => setRole(e.target.value as "viewer" | "editor")} className="rounded border dark:border-neutral-700 dark:bg-neutral-800"><option value="viewer">Viewer</option><option value="editor">Editor</option></select>
        <button className={btn}>Share</button>
        <span className="text-neutral-500">Members of your organization only.</span>
      </form>
      <div className="flex flex-wrap items-center gap-1">
        <button className={btn} onClick={() => run(async () => { const sh = await http().createShare(doc.document_id, { email: null, role: "viewer" }); setLink(sh.url ? new URL(sh.url, window.location.origin).href : null); })}>Create public view-only link</button>
        <span className="text-neutral-500">Anyone with the link can view and download; links never allow editing.</span>
      </div>
      {link && (
        <p role="status" className="rounded bg-amber-50 p-1 text-amber-900 dark:bg-amber-950 dark:text-amber-200">
          <code data-testid="share-link" className="break-all">{link}</code>{" "}
          <button className="underline" onClick={() => void navigator.clipboard?.writeText(link)}>Copy</button>
          <br />This link is shown only once — copy it now.
        </p>)}
      <ul className="space-y-1" aria-label="Current shares">
        {!shares ? <li>Loading…</li> : shares.length === 0 ? <li className="text-neutral-500">Not shared.</li> : shares.map((sh) => (
          <li key={sh.share_id} className="flex items-center gap-2">
            <span>{sh.kind === "link" ? "Public link (view-only)" : sh.email}</span><span className="text-neutral-500">{sh.role}</span>
            <button className="underline" onClick={() => run(() => http().deleteShare(sh.share_id))}>Revoke</button>
          </li>))}
      </ul>
    </div>
  );
}
