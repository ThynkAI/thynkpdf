/** Typed access to the Electron preload bridge (window.thynkpdf). Absent in the hosted web app. Keys never cross this bridge outward. */
export interface ProviderInfo { kind: string; label: string; needsKey: boolean; model: string; baseUrl: string; hasKey: boolean; keyHint: string | null }
export interface AiConfig { active: string | null; encryptionAvailable: boolean; kinds: ProviderInfo[] }
export interface AiAskReq { task: "ask" | "summarize"; question?: string; length?: "short" | "long"; chunks: { page: number; text: string }[] }
export interface AiAskOut { answer: string; citations: { page: number; quote: string }[]; uncertain: boolean; model: string; external_processing: boolean }
type R<T> = Promise<{ ok: true; value: T } | { ok: false; error: string }>;
export interface DesktopBridge {
  desktop: true;
  ai: {
    getConfig(): R<AiConfig>;
    saveProvider(p: { kind: string; model?: string; baseUrl?: string; apiKey?: string; makeActive?: boolean }): R<AiConfig>;
    removeKey(kind: string): R<AiConfig>;
    setActive(kind: string | null): R<AiConfig>;
    test(kind: string): R<{ ok: boolean; model: string; ms: number; sample: string }>;
    ask(req: AiAskReq): R<AiAskOut>;
  };
}
export function bridge(): DesktopBridge | null {
  if (typeof window === "undefined") return null;
  const b = (window as unknown as { thynkpdf?: DesktopBridge }).thynkpdf;
  return b && b.desktop ? b : null;
}
export async function call<T>(p: R<T>): Promise<T> { const r = await p; if (!r.ok) throw new Error(r.error); return r.value; }

/** Split page texts into chunks and rank them for a question (BM25-lite), so only relevant pages are sent to the provider. */
export function pickChunks(pages: (string | null)[], question: string | null, size = 1500, k = 8) {
  const chunks: { page: number; text: string }[] = [];
  pages.forEach((t, i) => { const s = (t ?? "").replace(/\s+/g, " ").trim(); for (let o = 0; o < s.length; o += size) chunks.push({ page: i + 1, text: s.slice(o, o + size) }); });
  if (!question) return chunks.slice(0, 16);
  const words = (x: string) => x.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) ?? [];
  const q = new Set(words(question));
  const scored = chunks.map((c) => { const w = words(c.text); return { c, s: w.filter((x) => q.has(x)).length / Math.sqrt(w.length + 1) }; });
  const top = scored.filter((x) => x.s > 0).sort((a, b) => b.s - a.s).slice(0, k).map((x) => x.c);
  return top.length ? top.sort((a, b) => a.page - b.page) : chunks.slice(0, 4);
}
