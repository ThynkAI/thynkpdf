"use client";
import { useEffect, useMemo, useState } from "react";
import { tokenFromSearch } from "@/lib/publicLinks";
import { Wordmark } from "@thynkpdf/ui";
import { HttpEditorApi } from "@thynkpdf/editor-client";
import { describeError } from "@/lib/documents";
import { PdfPages } from "./PdfPages";

/** Public share link: VIEW-ONLY (no editing tools are offered; the backend rejects editor links). */
export function SharedView() {
  const [token] = useState(() => tokenFromSearch(window.location.search));
  const api = useMemo(() => new HttpEditorApi({ baseUrl: process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000" }), []);
  const [info, setInfo] = useState<Awaited<ReturnType<HttpEditorApi["sharedInfo"]>> | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { api.sharedInfo(token).then(setInfo, (e) => setErr(describeError(e))); }, [api, token]);
  const fileUrl = api.sharedFileUrl(token);
  return (
    <div className="min-h-screen">
      <header className="flex h-12 items-center gap-3 border-b px-4 dark:border-neutral-800"><Wordmark /><h1 className="text-sm font-semibold">{info?.filename ?? "Shared document"}</h1>
        <span className="rounded bg-neutral-100 px-2 text-xs dark:bg-neutral-800" data-testid="view-only">View only</span>
        {info && <a className="ml-auto text-sm underline" href={fileUrl} download={info.filename}>Download</a>}
      </header>
      <main className="p-4">
        {err && <p role="alert" className="text-sm text-red-600">This link is invalid, revoked or expired. ({err})</p>}
        {info && <><p className="mb-3 text-center text-xs text-neutral-500">v{info.version} · {info.page_count} pages{info.expires_at ? ` · link expires ${new Date(info.expires_at).toLocaleString()}` : ""}</p><PdfPages url={fileUrl} /></>}
      </main>
    </div>
  );
}
