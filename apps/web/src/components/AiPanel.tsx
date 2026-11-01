"use client";
import { useEffect, useState } from "react";
import { useViewerStore } from "@thynkpdf/pdf-viewer";
import { RateLimitedError, type AiAnswer } from "@thynkpdf/editor-client";
import { useSession } from "@/lib/session";
import { describeError, http } from "@/lib/documents";
import { secondsLeft } from "@/lib/aiRetry";
import { ensureText } from "@/lib/documents";
import { bridge, call, pickChunks } from "@/lib/desktopBridge";
import { useAiConfig } from "@/lib/aiConfig";

/**
 * Document Q&A / summary. The server's default provider is an extractive STUB (thynkpdf-extractive-stub-v1): it returns
 * quoted sentences from the document, not generated text. The panel labels it as such. No external AI is used.
 */
export function AiPanel({ onSettings }: { onSettings?: () => void }) {
  const ref = useSession((s) => s.ref);
  const httpApi = useSession((s) => s.api.kind === "http");
  const has = useViewerStore((s) => s.pageSizes.length > 0);
  const docKey = useViewerStore((s) => s.docKey);
  const cfg = useAiConfig((c) => c.cfg);
  const b = bridge();
  useEffect(() => { if (b && !cfg) void call(b.ai.getConfig()).then((c) => useAiConfig.getState().set(c)).catch(() => undefined); }, [b, cfg]);
  const own = b && cfg?.active ? cfg.kinds.find((k) => k.kind === cfg.active) ?? null : null;
  const goToPage = useViewerStore((s) => s.goToPage);
  const [q, setQ] = useState("");
  const [ans, setAns] = useState<AiAnswer | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [until, setUntil] = useState<number | null>(null);
  const [, tick] = useState(0);
  useEffect(() => { if (!until) return; const t = setInterval(() => { tick((n) => n + 1); if (Date.now() >= until) setUntil(null); }, 500); return () => clearInterval(t); }, [until]);
  useEffect(() => { setAns(null); setErr(null); }, [ref?.document_id, docKey]);
  if (!has || (!own && !(ref && httpApi))) return null;
  /** Your own provider (desktop): page texts are extracted here, ranked, and sent over IPC to the main process. */
  const viaOwn = async (task: "ask" | "summarize", question?: string): Promise<AiAnswer> => {
    await ensureText();
    const pages = useViewerStore.getState().pagesText;
    const r = await call(b!.ai.ask({ task, question, length: "short", chunks: pickChunks(pages, question ?? null) }));
    return { ...r, retrieval: "local-lexical", document_id: ref?.document_id ?? "local", version: ref?.version ?? 0 } as unknown as AiAnswer;
  };
  const ask = (question: string) => (own ? viaOwn("ask", question) : http().aiAsk(ref!.document_id, question));
  const summarize = () => (own ? viaOwn("summarize") : http().aiSummarize(ref!.document_id, "short"));
  const wait = secondsLeft(until);
  const run = async (fn: () => Promise<AiAnswer>) => {
    setBusy(true); setErr(null);
    try { setAns(await fn()); }
    catch (e) {
      if (e instanceof RateLimitedError) { setUntil(Date.now() + (e.retryAfter ?? 10) * 1000); setErr(`Too many requests (limit ${e.details?.limit_per_minute ?? "?"}/min). You can retry in ${e.retryAfter ?? 10} s.`); }
      else setErr(describeError(e));
    } finally { setBusy(false); }
  };
  const stub = !own && (!ans || ans.model.includes("stub"));
  return (
    <section aria-labelledby="ai-h">
      <h2 id="ai-h" className="mb-1 font-semibold">Ask this document</h2>
      <p className="mb-1 rounded bg-neutral-100 px-1 text-[11px] text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300" data-testid="ai-mode">
        {own ? `Your AI: ${own.label} · ${own.model}` : stub ? "Excerpt mode (stub): built-in answers are quoted passages found by keyword search, not AI-written text." : `Model: ${ans!.model}`}
        {onSettings && <button className="ml-1 underline" onClick={onSettings} data-testid="ai-connect">{own ? "Change" : "Connect your own AI"}</button>}
      </p>
      <form className="flex gap-1 text-xs" onSubmit={(e) => { e.preventDefault(); if (q.trim()) void run(() => ask(q.trim())); }}>
        <input aria-label="Question about the document" placeholder="e.g. What is the total?" value={q} onChange={(e) => setQ(e.target.value)} className="min-w-0 flex-1 rounded border px-1 py-0.5 dark:border-neutral-700 dark:bg-neutral-800" />
        <button className="rounded border px-1.5 disabled:opacity-40 dark:border-neutral-700" disabled={busy || wait > 0 || !q.trim()}>Ask</button>
      </form>
      <button className="mt-1 text-xs underline disabled:opacity-40" disabled={busy || wait > 0} onClick={() => run(summarize)}>{own ? "Summarize" : "Key excerpts (summary)"}</button>
      {wait > 0 && <p className="text-xs text-amber-700" data-testid="ai-wait">Retry available in {wait} s</p>}
      {err && <p role="alert" className="text-xs text-red-600">{err}</p>}
      {busy && <p className="text-xs">Searching…</p>}
      {ans && (
        <div className="mt-1 space-y-1 text-xs" data-testid="ai-answer">
          {ans.uncertain && <p className="text-amber-700">The document doesn’t clearly answer this.</p>}
          <p className="whitespace-pre-wrap">{ans.answer}</p>
          {ans.citations.length > 0 && <ul className="space-y-1" aria-label="Sources">
            {ans.citations.map((c, i) => (
              <li key={i} className="border-l-2 pl-1 dark:border-neutral-700"><button className="underline" onClick={() => goToPage(c.page - 1)}>p.{c.page}</button> “{c.quote}”</li>))}
          </ul>}
          {ans.external_processing && <p className="text-amber-700">Processed by an external provider.</p>}
        </div>)}
    </section>
  );
}
