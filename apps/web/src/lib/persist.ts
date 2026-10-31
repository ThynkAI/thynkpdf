/**
 * Session persistence. The backend issues tokens only in JSON bodies (no httpOnly cookie support yet), so we keep them in
 * sessionStorage: survives reload in the same tab, cleared when the tab closes, not shared across tabs.
 * TRADEOFF: any script running on this origin (e.g. via XSS) can read sessionStorage, so a stolen refresh token is usable
 * for up to its lifetime (14 d). Switch to an httpOnly SameSite refresh cookie once the backend supports it.
 */
import type { TokenResponse } from "@thynkpdf/editor-client";
const KEY = "tp-session-v1";
export interface Persisted { tokens: TokenResponse | null; lastDocumentId: string | null }
const empty: Persisted = { tokens: null, lastDocumentId: null };
export function loadPersisted(storage: Storage | undefined = globalThis.sessionStorage): Persisted {
  try { const v = storage?.getItem(KEY); return v ? { ...empty, ...JSON.parse(v) } : empty; } catch { return empty; }
}
export function savePersisted(p: Partial<Persisted>, storage: Storage | undefined = globalThis.sessionStorage) {
  try { storage?.setItem(KEY, JSON.stringify({ ...loadPersisted(storage), ...p })); } catch { /* storage unavailable */ }
}
export function clearPersisted(storage: Storage | undefined = globalThis.sessionStorage) { try { storage?.removeItem(KEY); } catch { /* */ } }
