// Headless GUI check of the packaged Linux AppImage (run under xvfb-run): fresh HOME, open, edit, restart, reopen, no login.
// Usage: xvfb-run -a node apps/desktop/build/gui_smoke.mjs <fresh-home> 1 && xvfb-run -a node apps/desktop/build/gui_smoke.mjs <same-home> 2
import { createRequire } from "node:module";
const { chromium } = createRequire(import.meta.url)("../../../packages/frontend-tests/node_modules/@playwright/test");
import { spawn } from "node:child_process";
import fs from "node:fs";
const HOME = process.argv[2], step = process.argv[3];
const APP = process.env.APPIMAGE_PATH ?? new URL("../dist/", import.meta.url).pathname + fs.readdirSync(new URL("../dist/", import.meta.url)).find((f) => f.endsWith(".AppImage"));
const FIX = new URL("../../../packages/backend-tests/fixtures/simple-3page.pdf", import.meta.url).pathname;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const p = spawn(APP, ["--no-sandbox", "--remote-debugging-port=9333"], { env: { ...process.env, HOME, APPIMAGE_EXTRACT_AND_RUN: "1", XDG_CONFIG_HOME: HOME + "/.config" }, stdio: "ignore" });
let browser;
for (let i = 0; i < 60; i++) { try { browser = await chromium.connectOverCDP("http://127.0.0.1:9333"); break; } catch { await sleep(1000); } }
const ctx = browser.contexts()[0];
let page; for (let i = 0; i < 30 && !page; i++) { page = ctx.pages().find((x) => x.url().startsWith("app://")); if (!page) await sleep(1000); }
const out = { step, url: page.url() };
await page.waitForLoadState("networkidle").catch(() => {});
await sleep(2000);
const body = async () => (await page.locator("body").innerText());
out.signInTextOnHome = /sign in|log in|password/i.test(await body());
if (step === "1") {
  await page.evaluate(() => { localStorage.setItem("tp-theme", "dark"); localStorage.setItem("tp-persist-check", "kept"); });
  await page.getByTestId("file-input").setInputFiles(FIX);

  await page.getByTestId("version-id").filter({ hasText: /^v1 / }).waitFor({ timeout: 30000 });
  await page.getByRole("button", { name: "Rotate page clockwise" }).click();
  await page.getByTestId("version-id").filter({ hasText: /^v2 / }).waitFor({ timeout: 30000 });
  out.afterEdit = await page.getByTestId("version-id").innerText();
  out.engine = await page.getByTestId("backend-status").innerText();
  await page.screenshot({ path: HOME + "/step1.png" });
} else {
  out.persist = await page.evaluate(() => [localStorage.getItem("tp-theme"), localStorage.getItem("tp-persist-check")]);
  await page.goto("app://thynkpdf/documents/");
  await page.getByTestId("doc-table").waitFor({ timeout: 30000 });
  await page.getByTestId("doc-row").first().waitFor({ timeout: 30000 });
  out.rows = await page.getByTestId("doc-row").allInnerTexts();
  await page.getByRole("link", { name: "simple-3page.pdf" }).click();
  await page.getByTestId("version-id").filter({ hasText: /^v2 / }).waitFor({ timeout: 30000 });
  out.reopened = await page.getByTestId("version-id").innerText();
  out.signInTextAnywhere = /sign in|log in/i.test(await body());
  // FUX-02 symptoms: forms / AI / signature request routes exist in this build
  out.forms = await page.evaluate(async () => { const k = await window.thynkpdf.apiKey(); const t = (await (await fetch("/session/local", { method: "POST", headers: { "X-Thynkpdf-Key": k, "content-type": "application/json" }, body: "{}" })).json()).access_token;
    const h = { "X-Thynkpdf-Key": k, Authorization: "Bearer " + t, "content-type": "application/json" };
    const d = (await (await fetch("/documents", { headers: h })).json()); const id = (d.items ?? d)[0].document_id;
    return { forms: (await fetch(`/pdf/${id}/forms`, { headers: h })).status, ai: (await fetch("/ai/ask", { method: "POST", headers: h, body: JSON.stringify({ document_id: id, question: "Invoice?" }) })).status,
      sigreq: (await fetch("/signature-requests", { method: "POST", headers: h, body: "{}" })).status, noKey: (await fetch("/documents")).status }; });
  await page.screenshot({ path: HOME + "/step2.png" });
}
console.log(JSON.stringify(out));
await page.keyboard.press("Control+q").catch(() => {});
for (let i = 0; i < 20 && p.exitCode === null; i++) await sleep(500);
out.gracefulExit = p.exitCode; console.log("EXIT", p.exitCode);
await browser.close().catch(() => {});
p.kill("SIGTERM"); await sleep(1000); try { process.kill(p.pid, 0); p.kill("SIGKILL"); } catch {}
process.exit(0);
