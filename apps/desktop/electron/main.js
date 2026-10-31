// THYNKPDF desktop shell: starts the bundled backend sidecar on a free localhost port,
// opens the launcher, and stops the sidecar when the app quits.
const { app, BrowserWindow, shell, dialog, Menu } = require("electron");
const { spawn } = require("node:child_process");
const path = require("node:path");
const fs = require("node:fs");

let server = null, win = null, baseUrl = null;

function sidecarPath() {
  const exe = process.platform === "win32" ? "thynkpdf-server.exe" : "thynkpdf-server";
  const packaged = path.join(process.resourcesPath, "thynkpdf-server", exe);
  return app.isPackaged ? packaged : path.join(__dirname, "..", "sidecar", "thynkpdf-server", exe);
}

function startServer() {
  return new Promise((resolve, reject) => {
    const dataDir = path.join(app.getPath("userData"), "data");
    fs.mkdirSync(dataDir, { recursive: true });
    const log = fs.createWriteStream(path.join(dataDir, "server.log"), { flags: "a" });
    server = spawn(sidecarPath(), ["--port", "0", "--data-dir", dataDir, "--version", app.getVersion()],
                   { stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
    const timer = setTimeout(() => reject(new Error("The THYNKPDF engine took too long to start.")), 60000);
    let buf = "";
    server.stdout.on("data", (d) => {
      log.write(d); buf += d.toString();
      const m = buf.match(/THYNKPDF_READY (http:\/\/127\.0\.0\.1:\d+)/);
      if (m && !baseUrl) { baseUrl = m[1]; clearTimeout(timer); resolve(baseUrl); }
    });
    server.stderr.on("data", (d) => log.write(d));
    server.on("error", (e) => { clearTimeout(timer); reject(e); });
    server.on("exit", (code) => {
      clearTimeout(timer);
      if (!baseUrl) reject(new Error(`The THYNKPDF engine stopped (code ${code}). See ${dataDir}/server.log`));
      else if (!app.isQuitting) { dialog.showErrorBox("THYNKPDF", `The THYNKPDF engine stopped unexpectedly (code ${code}).`); app.quit(); }
    });
  });
}

function stopServer() {
  if (!server || server.exitCode !== null) return;
  try { server.stdin.end(); } catch {}            // sidecar exits when stdin closes
  setTimeout(() => { try { server.kill(); } catch {} }, 1500);
}

function createWindow() {
  win = new BrowserWindow({ width: 1280, height: 860, minWidth: 900, minHeight: 600, title: "THYNKPDF", backgroundColor: "#0f0b1a",
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true } });
  win.loadURL(baseUrl + "/desktop/");
  // Keep the app on our localhost origin; open anything else (e.g. release pages) in the real browser.
  const internal = (u) => u.startsWith(baseUrl + "/");
  win.webContents.setWindowOpenHandler(({ url }) => { if (!internal(url)) shell.openExternal(url); return { action: internal(url) ? "allow" : "deny" }; });
  win.webContents.on("will-navigate", (e, url) => { if (!internal(url)) { e.preventDefault(); shell.openExternal(url); } });
}

function menu() {
  const tpl = [
    ...(process.platform === "darwin" ? [{ role: "appMenu" }] : []),
    { label: "File", submenu: [{ label: "Home", accelerator: "CmdOrCtrl+H", click: () => win && win.loadURL(baseUrl + "/desktop/") },
      { label: "Open data folder", click: () => shell.openPath(path.join(app.getPath("userData"), "data")) }, { type: "separator" },
      process.platform === "darwin" ? { role: "close" } : { role: "quit" }] },
    { role: "editMenu" }, { role: "viewMenu" },
    { label: "Help", submenu: [{ label: "Check for updates", click: () => shell.openExternal("https://github.com/ThynkAI/thynkpdf/releases/latest") }] },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(tpl));
}

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on("second-instance", () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
  app.whenReady().then(async () => {
    try { await startServer(); } catch (e) { dialog.showErrorBox("THYNKPDF could not start", String(e.message || e)); app.quit(); return; }
    menu(); createWindow();
    app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
  });
  app.on("before-quit", () => { app.isQuitting = true; stopServer(); });
  app.on("window-all-closed", () => app.quit());
  app.on("quit", stopServer);
}
