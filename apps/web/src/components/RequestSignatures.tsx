"use client";
import { useEffect, useState } from "react";
import { useViewerStore } from "@thynkpdf/pdf-viewer";
import type { SignatureRequest, SignatureEvents } from "@thynkpdf/editor-client";
import { useSession } from "@/lib/session";
import { useSignature } from "@/lib/signature";
import { describeError, http, openLatest } from "@/lib/documents";
import { buildRequestFields, isEmail } from "@/lib/requestFields";
import { getGeom } from "@/lib/pageGeom";
import { displayBoxToPdfRect } from "@/lib/geometry";

type Link = { signer_index: number; email: string; url: string };
const btn = "rounded border px-2 py-1 text-xs disabled:opacity-40 dark:border-neutral-700";

/** Signature requests: create (links shown ONCE — no email is sent), list status, events (hash chain), cancel. */
export function RequestSignatures() {
  const ref = useSession((s) => s.ref);
  const { currentPage, pageSizes } = useViewerStore();
  const placement = useSignature((s) => s.placement);
  const [signers, setSigners] = useState([{ name: "", email: "" }]);
  const [title, setTitle] = useState(""); const [message, setMessage] = useState("");
  const [sequential, setSequential] = useState(false); const [withDate, setWithDate] = useState(true);
  const [links, setLinks] = useState<Link[] | null>(null);
  const [reqs, setReqs] = useState<SignatureRequest[] | null>(null);
  const [events, setEvents] = useState<Record<string, SignatureEvents>>({});
  const [err, setErr] = useState<string | null>(null);
  const load = () => { if (ref) http().listSignatureRequests(ref.document_id).then(setReqs, (e) => setErr(describeError(e))); };
  useEffect(load, [ref?.document_id]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!ref) return null;
  const valid = signers.length > 0 && signers.every((x) => x.name.trim() && isEmail(x.email));

  const create = async () => {
    setErr(null);
    try {
      const page = placement?.page ?? currentPage;
      const g = await getGeom(page);
      const sz = pageSizes[page];
      const base = placement && g
        ? displayBoxToPdfRect(placement.left, placement.top, placement.width, placement.height, g, 1)
        : { x: 72, y: 72, width: Math.min(200, sz.width * 0.4), height: 40 };
      const out = await http().createSignatureRequest({
        document_id: ref.document_id, version: ref.version, title: title.trim() || null, message: message.trim(),
        signers: signers.map((x, i) => ({ name: x.name.trim(), email: x.email.trim(), ...(sequential ? { order: i + 1 } : {}) })),
        fields: buildRequestFields(signers.length, page + 1, base, withDate, g?.width ?? sz.width),
      });
      const raw = out.signer_links as unknown as { signer_index: number; email: string; path: string }[];
      setLinks(raw.map((l) => ({ signer_index: l.signer_index, email: l.email, url: new URL(l.path, window.location.origin).href })));
      load();
    } catch (e) { setErr(describeError(e)); }
  };

  return (
    <div className="mt-2 space-y-2 rounded border p-2 text-xs dark:border-neutral-700" data-testid="request-panel">
      <p className="font-semibold">Request signatures</p>
      {links ? (
        <div role="status" className="space-y-1 rounded bg-amber-50 p-2 text-amber-900 dark:bg-amber-950 dark:text-amber-100" data-testid="signer-links">
          <p><b>No email is sent.</b> Copy each private link and send it to the signer yourself. These links are shown <b>only once</b> and cannot be retrieved again.</p>
          {links.map((l) => (
            <div key={l.signer_index} className="flex items-center gap-1">
              <span className="shrink-0">{l.email}:</span>
              <code className="min-w-0 flex-1 truncate" data-testid="signer-link">{l.url}</code>
              <button className={btn} aria-label={`Copy link for ${l.email}`} onClick={() => void navigator.clipboard?.writeText(l.url)}>Copy</button>
            </div>))}
          <button className={btn} onClick={() => setLinks(null)}>I have copied the links</button>
        </div>
      ) : (
        <form className="space-y-1" onSubmit={(e) => { e.preventDefault(); if (valid) void create(); }}>
          <input aria-label="Request title" placeholder="Title (optional)" value={title} onChange={(e) => setTitle(e.target.value)} className="w-full rounded border px-1 dark:border-neutral-700 dark:bg-neutral-800" />
          <textarea aria-label="Message to signers" placeholder="Message (optional)" value={message} onChange={(e) => setMessage(e.target.value)} className="w-full rounded border px-1 dark:border-neutral-700 dark:bg-neutral-800" />
          {signers.map((x, i) => (
            <div key={i} className="flex gap-1">
              <input aria-label={`Signer ${i + 1} name`} placeholder="Name" value={x.name} onChange={(e) => setSigners(signers.map((y, j) => j === i ? { ...y, name: e.target.value } : y))} className="min-w-0 flex-1 rounded border px-1 dark:border-neutral-700 dark:bg-neutral-800" />
              <input aria-label={`Signer ${i + 1} email`} type="email" placeholder="Email" value={x.email} onChange={(e) => setSigners(signers.map((y, j) => j === i ? { ...y, email: e.target.value } : y))} className="min-w-0 flex-1 rounded border px-1 dark:border-neutral-700 dark:bg-neutral-800" />
              {signers.length > 1 && <button type="button" aria-label={`Remove signer ${i + 1}`} onClick={() => setSigners(signers.filter((_, j) => j !== i))}>✕</button>}
            </div>))}
          <button type="button" className={btn} onClick={() => setSigners([...signers, { name: "", email: "" }])}>Add signer</button>
          <label className="block"><input type="checkbox" checked={sequential} onChange={(e) => setSequential(e.target.checked)} /> Sign in order</label>
          <label className="block"><input type="checkbox" checked={withDate} onChange={(e) => setWithDate(e.target.checked)} /> Add a date field per signer</label>
          <p className="text-neutral-500">Fields go on page {(placement?.page ?? currentPage) + 1} {placement ? "at the placed signature box" : "near the bottom-left"} (stacked per signer).</p>
          <button className="rounded bg-brand-600 px-2 py-1 text-white disabled:opacity-40" disabled={!valid}>Create request for v{ref.version}</button>
        </form>)}
      {err && <p role="alert" className="text-red-600">{err}</p>}
      <div>
        <p className="font-semibold">Requests for this document</p>
        {!reqs ? <p>Loading…</p> : reqs.length === 0 ? <p className="text-neutral-500">None.</p> : (
          <ul className="space-y-1" data-testid="request-list">
            {reqs.map((r) => (
              <li key={r.request_id} className="rounded border p-1 dark:border-neutral-700">
                <p><b>{r.title || "Untitled"}</b> · <span data-testid="request-status">{r.status}</span> · v{r.version} · chain {r.chain_valid ? "valid" : "INVALID"}</p>
                <p className="text-neutral-500">{r.signers.map((x) => `${x.name} (${x.status})`).join(", ")}</p>
                {r.status === "needs_attention" && <p className="text-amber-700">The document changed while signing; nothing was overwritten. Review and send a new request.</p>}
                <div className="flex gap-2">
                  {r.status === "pending" && <button className="underline" onClick={() => http().cancelSignatureRequest(r.request_id).then(load, (e) => setErr(describeError(e)))}>Cancel</button>}
                  <button className="underline" onClick={() => http().signatureRequestEvents(r.request_id).then((ev) => setEvents({ ...events, [r.request_id]: ev }), (e) => setErr(describeError(e)))}>Events</button>
                  {r.final_version_id && <button className="underline" onClick={() => void openLatest(r.document_id)}>Open signed version</button>}
                </div>
                {events[r.request_id] && <ol className="mt-1 text-neutral-500">{events[r.request_id].events.map((ev, i) => <li key={i}>{ev.type} · {ev.actor} · {ev.at}</li>)}</ol>}
              </li>))}
          </ul>)}
      </div>
    </div>
  );
}
