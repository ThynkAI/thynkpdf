// Preload (sandboxed, contextIsolation): exposes a tiny, typed bridge. API keys go IN (save) but never come back OUT.
const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("thynkpdf", {
  desktop: true,
  /** Per-launch key the local engine requires on every API call (main process only answers this app's own origin). */
  apiKey: () => ipcRenderer.invoke("desktop:apiKey").then((r) => { if (!r.ok) throw new Error(r.error); return r.value; }),
  ai: {
    getConfig: () => ipcRenderer.invoke("ai:getConfig"),
    saveProvider: (p) => ipcRenderer.invoke("ai:saveProvider", p),
    removeKey: (kind) => ipcRenderer.invoke("ai:removeKey", kind),
    setActive: (kind) => ipcRenderer.invoke("ai:setActive", kind),
    test: (kind) => ipcRenderer.invoke("ai:test", kind),
    ask: (req) => ipcRenderer.invoke("ai:ask", req),
  },
});
