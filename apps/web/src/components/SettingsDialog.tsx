"use client";
import { useEffect, useState } from "react";
import { bridge, call, type AiConfig, type ProviderInfo } from "@/lib/desktopBridge";
import { useAiConfig } from "@/lib/aiConfig";

/** Settings → AI Providers. Keys are sent once to the desktop main process, encrypted with the OS keychain, and never read back. */
export function SettingsDialog({ onClose }: { onClose(): void }) {
  const b = bridge();
  const [cfg, setCfg] = useState<AiConfig | null>(null);
  const [kind, setKind] = useState<string>("openai");
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { if (b) void call(b.ai.getConfig()).then((c) => { setCfg(c); useAiConfig.getState().set(c); if (c.active) setKind(c.active); }).catch((e) => setErr(e.message)); }, [b]);
  const update = (c: AiConfig) => { setCfg(c); useAiConfig.getState().set(c); };
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-labelledby="st-h" data-testid="settings-dialog" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => { if (e.key === "Escape") onClose(); }}
        className="max-h-[90vh] w-full max-w-2xl overflow-auto rounded-lg bg-white p-5 text-sm shadow-xl dark:bg-neutral-900">
        <div className="mb-1 flex items-center"><h2 id="st-h" className="text-base font-semibold">Settings</h2>
          <button className="ml-auto rounded px-2 py-1 text-xs underline" onClick={onClose}>Close (Esc)</button></div>
        <h3 className="mt-2 font-semibold">AI Providers <span className="text-xs font-normal text-neutral-500">— connect your own AI</span></h3>
        <p className="mb-3 text-xs text-neutral-600 dark:text-neutral-400">“Ask this document” uses the selected provider. With none selected, the built-in excerpt finder is used (nothing leaves your computer).
          Keys are encrypted with your operating system’s keychain and stay in the desktop app’s main process: they are never shown again, stored in the page, or logged. Document text is sent to the provider you pick and is treated as untrusted content.</p>
        {!b && <p className="rounded border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900" data-testid="ai-web-note">Connecting your own AI is available in the THYNKPDF desktop app, where keys can be kept in the OS keychain. The web version uses the server’s AI settings.</p>}
        {err && <p role="alert" className="text-xs text-red-600">{err}</p>}
        {b && cfg && (
          <div className="grid gap-3 sm:grid-cols-[11rem_1fr]">
            <ul role="tablist" aria-label="AI provider" className="space-y-1">
              <li><button role="tab" aria-selected={!cfg.active} onClick={async () => update(await call(b.ai.setActive(null)))}
                className={`w-full rounded px-2 py-1.5 text-left text-xs ${!cfg.active ? "bg-neutral-900 text-white dark:bg-white dark:text-neutral-900" : "hover:bg-neutral-100 dark:hover:bg-neutral-800"}`}>Built-in (no external AI){!cfg.active && " ✓"}</button></li>
              {cfg.kinds.map((k) => (
                <li key={k.kind}><button role="tab" aria-selected={kind === k.kind} onClick={() => setKind(k.kind)} data-testid={`prov-${k.kind}`}
                  className={`flex w-full items-center rounded px-2 py-1.5 text-left text-xs ${kind === k.kind ? "ring-2 ring-[#E8141C]" : "hover:bg-neutral-100 dark:hover:bg-neutral-800"}`}>
                  <span className="flex-1">{k.label}</span>{cfg.active === k.kind && <span className="rounded bg-[#E8141C] px-1 text-[10px] font-semibold text-white">ACTIVE</span>}</button></li>))}
            </ul>
            {cfg.kinds.filter((k) => k.kind === kind).map((k) => <ProviderForm key={k.kind} p={k} active={cfg.active === k.kind} encryption={cfg.encryptionAvailable} onConfig={update} />)}
          </div>)}
      </div>
    </div>
  );
}

function ProviderForm({ p, active, encryption, onConfig }: { p: ProviderInfo; active: boolean; encryption: boolean; onConfig(c: AiConfig): void }) {
  const b = bridge()!;
  const [model, setModel] = useState(p.model);
  const [baseUrl, setBaseUrl] = useState(p.baseUrl);
  const [apiKey, setApiKey] = useState("");
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const input = "w-full rounded border border-neutral-300 bg-white px-2 py-1 text-xs dark:border-neutral-700 dark:bg-neutral-800";
  const save = async (makeActive = false) => {
    setBusy(true); setStatus(null);
    try { onConfig(await call(b.ai.saveProvider({ kind: p.kind, model, baseUrl, apiKey: apiKey || undefined, makeActive }))); setApiKey(""); setStatus({ ok: true, text: makeActive ? "Saved and selected." : "Saved." }); return true; }
    catch (e) { setStatus({ ok: false, text: (e as Error).message }); return false; } finally { setBusy(false); }
  };
  const test = async () => {
    if (!(await save(false))) return;
    setBusy(true);
    try { const r = await call(b.ai.test(p.kind)); setStatus({ ok: true, text: `Connected to ${r.model} in ${r.ms} ms (reply: “${r.sample}”).` }); }
    catch (e) { setStatus({ ok: false, text: `Test failed: ${(e as Error).message}` }); } finally { setBusy(false); }
  };
  return (
    <form className="space-y-2" onSubmit={(e) => { e.preventDefault(); void save(true); }} data-testid="provider-form">
      <h4 className="font-semibold">{p.label}</h4>
      {p.needsKey || p.kind === "openai_compatible" ? (
        <label className="block text-xs">API key{!p.needsKey && " (optional)"}
          <input type="password" autoComplete="off" spellCheck={false} className={input} value={apiKey} onChange={(e) => setApiKey(e.target.value)}
            placeholder={p.hasKey ? `Saved in OS keychain (${p.keyHint ?? "hidden"}) — type to replace` : "Paste your API key"} aria-label={`${p.label} API key`} />
        </label>) : <p className="text-xs text-neutral-500">No key needed — Ollama runs on this computer.</p>}
      {p.hasKey && <button type="button" className="text-[11px] underline" onClick={async () => onConfig(await call(b.ai.removeKey(p.kind)))}>Remove saved key</button>}
      {!encryption && p.needsKey && <p className="text-xs text-amber-700">OS keychain encryption is unavailable on this system, so keys cannot be saved.</p>}
      <label className="block text-xs">Model<input className={input} value={model} onChange={(e) => setModel(e.target.value)} aria-label="Model" placeholder="model name" /></label>
      <label className="block text-xs">Base URL<input className={input} value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} aria-label="Base URL" placeholder="https://…/v1" /></label>
      <div className="flex flex-wrap gap-2 pt-1">
        <button type="button" disabled={busy} onClick={() => void test()} className="rounded border border-neutral-300 px-2 py-1 text-xs disabled:opacity-50 dark:border-neutral-700">Test connection</button>
        <button type="submit" disabled={busy} className="rounded bg-[#E8141C] px-2 py-1 text-xs font-semibold text-white disabled:opacity-50">{active ? "Save" : "Save & use this provider"}</button>
      </div>
      {busy && <p className="text-xs">Working…</p>}
      {status && <p role="status" className={`text-xs ${status.ok ? "text-green-700 dark:text-green-400" : "text-red-600"}`} data-testid="provider-status">{status.text}</p>}
    </form>
  );
}
