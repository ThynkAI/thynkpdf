/**
 * Session persistence. Only the last-opened document id is stored (sessionStorage). Tokens are NOT persisted:
 * the access token lives in memory and the refresh token is the backend's httpOnly SameSite=Strict cookie `thynkpdf_rt`
 * (Path=/auth), which page scripts cannot read. After a reload the app calls POST /auth/refresh with credentials:"include".
 */
const KEY = "tp-session-v2";
export interface Persisted { lastDocumentId: string | null }
const empty: Persisted = { lastDocumentId: null };
export function loadPersisted(storage: Storage | undefined = globalThis.sessionStorage): Persisted {
  try { const v = storage?.getItem(KEY); return v ? { ...empty, ...JSON.parse(v) } : empty; } catch { return empty; }
}
export function savePersisted(p: Partial<Persisted>, storage: Storage | undefined = globalThis.sessionStorage) {
  try { storage?.setItem(KEY, JSON.stringify({ ...loadPersisted(storage), ...p })); storage?.removeItem("tp-session-v1"); } catch { /* storage unavailable */ }
}
export function clearPersisted(storage: Storage | undefined = globalThis.sessionStorage) { try { storage?.removeItem(KEY); } catch { /* */ } }
