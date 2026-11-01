// Preload (sandboxed, contextIsolation): exposes a tiny, typed bridge. API keys go IN (save) but never come back OUT.
const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("thynkpdf", {
  desktop: true,
  ai: {
    getConfig: () => ipcRenderer.invoke("ai:getConfig"),
    saveProvider: (p) => ipcRenderer.invoke("ai:saveProvider", p),
    removeKey: (kind) => ipcRenderer.invoke("ai:removeKey", kind),
    setActive: (kind) => ipcRenderer.invoke("ai:setActive", kind),
    test: (kind) => ipcRenderer.invoke("ai:test", kind),
    ask: (req) => ipcRenderer.invoke("ai:ask", req),
  },
});
