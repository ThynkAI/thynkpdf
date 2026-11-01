"use client";
import { useEffect, useState } from "react";
import type { DocumentInfo, Share } from "@thynkpdf/editor-client";
import { describeError, http, isDesktop } from "@/lib/documents";
import { sharedPageUrl } from "@/lib/publicLinks";

const btn = "rounded border px-2 py-1 text-xs dark:border-neutral-700";

/** Sharing: org-member grants (viewer/editor) and public VIEW-ONLY links. A link URL is returned once by the server. */
export function SharePanel({ doc, onError }: { doc: DocumentInfo; onError: (m: string | null) => void }) {
  const [shares, setShares] = useState<Share[] | null>(null);
    const [link, setLink] = useState<string | null>(null);
  const load = () => http().listShares(doc.document_id).then(setShares, (e) => onError(describeError(e)));
  useEffect(() => { void load(); }, [doc.document_id]); // eslint-disable-line react-hooks/exhaustive-deps
  const desktop = isDesktop();
  const run = async (fn: () => Promise<unknown>) => { onError(null); try { await fn(); await load(); } catch (e) { onError(describeError(e)); } };
  return (
    <div className="mt-2 space-y-2 rounded border p-2 text-xs dark:border-neutral-700" data-testid="share-panel">
      {desktop ? <p className="text-neutral-500" data-testid="share-local-only">Share links need a hosted THYNKPDF server — a link from this app would only work on this computer while it is open. Download a copy to send the file instead.</p> : <div className="flex flex-wrap items-center gap-1">
        <button className={btn} onClick={() => run(async () => { const sh = await http().createShare(doc.document_id, { email: null, role: "viewer" }); setLink(sh.url ? sharedPageUrl(sh.url, window.location.origin) : null); })}>Create public view-only link</button>
        <span className="text-neutral-500">Anyone with the link can view and download; links never allow editing.</span>
      </div>}
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
