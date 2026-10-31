"use client";
/** Saved signature images, stored only in this browser's IndexedDB (never uploaded unless stamped into a PDF you save). */
export interface SavedSig { id: string; dataUrl: string; mime: "image/png" | "image/jpeg"; aspect: number; createdAt: number }
const DB = "thynkpdf", STORE = "signatures";
function open(): Promise<IDBDatabase> {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => { if (!r.result.objectStoreNames.contains(STORE)) r.result.createObjectStore(STORE, { keyPath: "id" }); };
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  });
}
async function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  return new Promise((res, rej) => { const t = db.transaction(STORE, mode); const q = fn(t.objectStore(STORE)); t.oncomplete = () => { db.close(); res(q.result); }; t.onerror = () => { db.close(); rej(t.error); }; });
}
export const listSigs = async () => (await tx<SavedSig[]>("readonly", (s) => s.getAll() as IDBRequest<SavedSig[]>)).sort((a, b) => b.createdAt - a.createdAt);
export const saveSig = (s: Omit<SavedSig, "id" | "createdAt">) => { const v: SavedSig = { ...s, id: crypto.randomUUID(), createdAt: Date.now() }; return tx("readwrite", (st) => st.put(v)).then(() => v); };
export const deleteSig = (id: string) => tx("readwrite", (s) => s.delete(id)).then(() => undefined);
