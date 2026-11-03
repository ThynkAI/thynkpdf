import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import fs from "node:fs";
import path from "node:path";
const here = path.dirname(new URL(import.meta.url).pathname);
const F = (n: string) => path.join(here, "fixtures", n);
const EV = path.join(here, "..", "..", "..", "docs", "audit", "evidence");
const API = process.env.THYNKPDF_API_URL ?? "http://localhost:8123";
const EMAIL = process.env.THYNKPDF_DEV_EMAIL ?? "dev@thynkpdf.dev";
const PASSWORD = process.env.THYNKPDF_DEV_PASSWORD ?? "ThynkDev-2026!";
const metrics: Record<string, unknown> = { commit: process.env.AUDIT_COMMIT ?? "unknown" };
test.afterAll(() => { fs.writeFileSync(path.join(EV, `audit-metrics-${String(metrics.commit).slice(0, 7)}.json`), JSON.stringify(metrics, null, 2)); });

async function online(page: Page) {
  await page.goto("/");
  // 7604fc5: "Online — sign in…" / "Connected"; bc7ee6b (v0.1.7): "Files open and edit locally…" / "Connected to the THYNKPDF server"
  await expect(page.getByTestId("backend-status")).toHaveText(/Online|Connected|locally/, { timeout: 20_000 });
}
async function signIn(page: Page) {
  await online(page);
  if (/Connected/.test(await page.getByTestId("backend-status").innerText())) return;
  const cloud = page.getByText("Cloud sync (optional)");
  if (await cloud.count()) await cloud.click();
  await page.getByLabel("Username").fill(EMAIL); await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByTestId("backend-status")).toHaveText(/^Connected/);
}
async function upload(page: Page, f: string) {
  await page.getByTestId("file-input").setInputFiles(F(f));
  await expect(page.getByTestId("version-id")).toHaveText(/^v1 /, { timeout: 30_000 });
}

// FUX-01 (Blocker): a fresh user with no account cannot use any server tool; there is no way to create one in the UI.
test("FUX-01 known-failing: fresh user (no account) can use page tools after opening a PDF", async ({ page }) => {
  // Known failing on 7604fc5 (v0.1.6). PASSES on bc7ee6b (v0.1.7: local pdf-lib page ops). Kept as a regression guard:
  // open PR #33 would restore the server-document gate and make this fail again.
  test.fail(process.env.AUDIT_COMMIT?.startsWith("7604fc5") ?? false, "FUX-01 on v0.1.6: tools gated behind sign-in");
  await online(page);
  await page.getByTestId("file-input").setInputFiles(F("mixed-rotated.pdf"));
  await expect(page.getByTestId("status-page")).toHaveText("Page 1 of 5");
  await expect(page.getByRole("button", { name: "Rotate page clockwise" })).toBeEnabled({ timeout: 5_000 });
});

// FUX-04: "Ask AI" home tile vs keyword-excerpt default provider.
test("FUX-04 known-failing: AI entry point label matches excerpt-search behaviour", async ({ page }) => {
  test.fail(true, "FUX-04: tile says 'Ask AI' while the default provider is keyword excerpt search");
  await signIn(page); await upload(page, "large-320.pdf");
  await page.getByRole("button", { name: /Ask AI/ }).first().click();
  await expect(page.getByTestId("ai-mode")).toContainText("Excerpt mode");
  const labels = await page.evaluate(() => [...document.querySelectorAll("button,a")].map((b) => b.textContent?.trim() ?? ""));
  expect(labels.some((t) => /Ask AI/.test(t))).toBe(false);
});

// FUX-05: replacement longer than the original is reported as success though it runs off the page.
test("FUX-05 known-failing: longer replacement text warns that it may not fit", async ({ page }) => {
  test.fail(true, "FUX-05: success shown, text overflows the page edge (see evidence/output-text-edit-longer-v3.png)");
  await signIn(page); await upload(page, "multifont.pdf");
  await page.getByLabel("Find text").fill("Courier");
  await page.getByLabel("Replacement text").fill("Courier-with-a-much-much-longer-replacement-string-that-overflows-the-page");
  await page.getByRole("button", { name: "Replace", exact: true }).click();
  await expect(page.getByTestId("text-edit-result")).toBeVisible();
  await expect(page.locator("body")).toContainText(/may not fit|longer than|overflow/i);
});

// FUX-06: raw error codes leak into user messages.
test("FUX-06 known-failing: text-edit errors are plain language (no raw codes)", async ({ page }) => {
  test.fail(true, "FUX-06: messages like 'TEXT_NOT_FOUND: …' and 'HTTP_405: POST … failed: 405' are shown verbatim");
  await signIn(page); await upload(page, "multifont.pdf");
  await page.getByLabel("Find text").fill("SplitRun"); await page.getByLabel("Replacement text").fill("Joined");
  await page.getByRole("button", { name: "Replace", exact: true }).click();
  const alert = page.locator("[role=alert]").filter({ hasText: /\S/ }).first();
  await expect(alert).toBeVisible();
  const txt = await alert.innerText(); metrics.fux06_message = txt;
  expect(txt).not.toMatch(/\b[A-Z]{3,}_[A-Z_]+:|HTTP_\d{3}|failed: \d{3}/);
});

// FUX-07: status bar is a fixed 28px row; long errors are clipped / overflow at minimum size.
for (const vp of [{ w: 1024, h: 700, z: 1 }, { w: 683, h: 384, z: 2 }]) {
  test(`FUX-07 known-failing: long status error stays readable at ${vp.w * vp.z}x${vp.h * vp.z} zoom ${vp.z * 100}%`, async ({ browser }) => {
    test.fail(true, "FUX-07: fixed-height single-row footer clips/overflows long messages");
    const ctx = await browser.newContext({ viewport: { width: vp.w, height: vp.h }, deviceScaleFactor: vp.z });
    const page = await ctx.newPage(); await online(page);
    const long = "Q3-financial-report-for-the-board-of-directors-final-revised-version-2026-copy-with-a-very-long-name.pdf";
    await page.getByTestId("file-input").setInputFiles({ name: long, mimeType: "application/pdf", buffer: Buffer.from("not a pdf at all") });
    const err = page.getByTestId("error"); await expect(err).toBeVisible();
    await page.screenshot({ path: path.join(EV, `statusbar-long-error-${vp.w}x${vp.h}@${vp.z}x.png`) });
    const m = await page.locator("footer[role=status]").evaluate((f) => ({ sw: f.scrollWidth, cw: f.clientWidth, sh: f.scrollHeight, ch: f.clientHeight }));
    const e = await err.evaluate((el) => { const r = el.getBoundingClientRect(); return { right: r.right, vw: window.innerWidth, text: el.textContent }; });
    metrics[`fux07_${vp.w}x${vp.h}@${vp.z}`] = { ...m, ...e };
    expect(m.sw <= m.cw && m.sh <= m.ch && e.right <= e.vw).toBe(true);
    await ctx.close();
  });
}

// FUX-08: compress result rounds to KB and hides the real change.
test("FUX-08 known-failing: compress result shows a meaningful before/after for small files", async ({ page }) => {
  test.fail(true, "FUX-08: '1 KB → 1 KB (now v2)' although 1341→957 bytes");
  await signIn(page); await upload(page, "tiny.pdf");
  await page.getByRole("button", { name: "Organize" }).click();
  await page.getByTestId("compress-section").getByRole("button", { name: "Compress" }).click();
  const r = page.getByTestId("compress-result"); await expect(r).toBeVisible({ timeout: 20_000 });
  const t = await r.innerText(); metrics.fux08 = t;
  const m = t.match(/(\d+) KB → (\d+) KB/);
  expect(m && m[1] === m[2]).toBe(false);
});

// FUX-09: no unsaved-changes guard (no beforeunload anywhere in apps/web).
test("FUX-09 known-failing: reloading with unsaved local annotations asks first", async ({ page }) => {
  test.fail(true, "FUX-09: no beforeunload handler; unsaved local markup is discarded silently");
  await page.goto("/");
  await page.getByTestId("file-input").setInputFiles(F("multifont.pdf"));
  await expect(page.getByTestId("status-page")).toHaveText("Page 1 of 1");
  await page.getByRole("button", { name: "Annotate" }).click();
  const layer = page.getByRole("button", { name: /Tool: (Draw|Pen|Ink)/i }).first();
  if (await layer.count()) await layer.click();
  const pg = page.locator("[data-testid=viewer-scroll] canvas").first(); const b = (await pg.boundingBox())!;
  await page.mouse.move(b.x + 100, b.y + 100); await page.mouse.down(); await page.mouse.move(b.x + 220, b.y + 160, { steps: 8 }); await page.mouse.up();
  let dialogSeen = false; page.on("dialog", async (d) => { dialogSeen = true; await d.dismiss(); });
  const hasHandler = await page.evaluate(() => { const ev = new Event("beforeunload", { cancelable: true }); window.dispatchEvent(ev); return ev.defaultPrevented; });
  metrics.fux09 = { hasHandler, dialogSeen };
  expect(hasHandler).toBe(true);
});

// Performance baseline (local open of a real 320-page fixture, no backend involved).
test("PERF: 320-page document open, search, scroll, thumbnails, reopen memory", async ({ page }) => {
  await page.goto("/");
  const t0 = Date.now();
  await page.getByTestId("file-input").setInputFiles(F("large-320.pdf"));
  await expect(page.getByTestId("status-page")).toHaveText("Page 1 of 320");
  await page.locator("[data-testid=viewer-scroll] canvas").first().waitFor();
  const firstPage = Date.now() - t0;
  const s0 = Date.now();
  await page.getByLabel(/Find (text|in document)|Search document/).first().fill("needle-unique-word").catch(() => {});
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("search-count")).toContainText(/1/, { timeout: 60_000 }).catch(() => {});
  const search = Date.now() - s0; const searchText = await page.getByTestId("search-count").innerText().catch(() => "n/a");
  const sc0 = Date.now();
  const sm = await page.getByTestId("viewer-scroll").evaluate((el) => { el.scrollTop = el.scrollHeight; return { sh: el.scrollHeight, ch: el.clientHeight, st: el.scrollTop }; });
  metrics.scrollProbe = sm;
  await page.getByLabel("Page number").fill("320"); await page.getByLabel("Page number").press("Enter");
  await expect(page.getByTestId("status-page")).toHaveText(/Page 3(19|20) of 320/, { timeout: 30_000 });
  const scrollEnd = Date.now() - sc0;
  const heap: number[] = [];
  for (let i = 0; i < 5; i++) {
    await page.getByTestId("file-input").setInputFiles(F(i % 2 ? "large-320.pdf" : "mixed-rotated.pdf"));
    await expect(page.getByTestId("status-page")).toHaveText(i % 2 ? "Page 1 of 320" : "Page 1 of 5");
    heap.push(await page.evaluate(() => (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize ?? -1));
  }
  metrics.perf = { fixture: "large-320.pdf 224 KB, 320 Letter pages, 31 text lines/page", firstPageMs: firstPage, searchMs: search, searchText, scrollToEndMs: scrollEnd, heapAfterReopensMB: heap.map((h) => Math.round(h / 1e6)) };
});

// Visual + axe across viewports (evidence, not pass/fail on violations count).
for (const vp of [{ w: 1024, h: 700 }, { w: 1366, h: 768 }, { w: 1920, h: 1080 }, { w: 2560, h: 1440 }, { w: 683, h: 384, z: 2 }]) {
  test(`VISUAL/AXE ${vp.w}x${vp.h}${vp.z ? " @200%" : ""}`, async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: vp.w, height: vp.h }, deviceScaleFactor: vp.z ?? 1 });
    const page = await ctx.newPage(); const tag = `${vp.w}x${vp.h}${vp.z ? "@200" : ""}`;
    await page.goto("/"); await page.waitForTimeout(800);
    await page.screenshot({ path: path.join(EV, `visual-home-${tag}.png`) });
    const a1 = await new AxeBuilder({ page }).analyze();
    await page.getByTestId("file-input").setInputFiles(F("Quarterly-financial-report-for-the-board-of-directors-final-revised-version-2026-copy-with-a-very-long-name.pdf"));
    await expect(page.getByTestId("status-page")).toHaveText("Page 1 of 1"); await page.waitForTimeout(800);
    await page.screenshot({ path: path.join(EV, `visual-editor-longname-${tag}.png`) });
    const a2 = await new AxeBuilder({ page }).analyze();
    const overflowX = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    const hdr = await page.locator("header").first().evaluate((h) => ({ sw: h.scrollWidth, cw: h.clientWidth })).catch(() => null);
    metrics[`visual_${tag}`] = { overflowX, header: hdr, axeHome: a1.violations.map((v) => `${v.id}(${v.impact}) x${v.nodes.length}`), axeEditor: a2.violations.map((v) => `${v.id}(${v.impact}) x${v.nodes.length}`) };
    await ctx.close();
  });
}

// Keyboard: tab order on home, focus visibility, signature dialog trap/Escape/restore.
test("A11Y keyboard: home tab order, focus ring, signature dialog Escape + focus restore", async ({ page }) => {
  await page.goto("/"); await page.waitForTimeout(500);
  const stops: { name: string; ring: boolean }[] = [];
  for (let i = 0; i < 25; i++) {
    await page.keyboard.press("Tab");
    stops.push(await page.evaluate(() => { const el = document.activeElement as HTMLElement; const cs = getComputedStyle(el);
      return { name: (el.getAttribute("aria-label") || el.textContent || el.tagName).trim().slice(0, 40), ring: cs.outlineStyle !== "none" && cs.outlineWidth !== "0px" || cs.boxShadow !== "none" }; }));
  }
  await page.getByTestId("file-input").setInputFiles(F("multifont.pdf"));
  await expect(page.getByTestId("status-page")).toHaveText("Page 1 of 1");
  const open = page.getByRole("button", { name: /Create signature/ }).first(); await open.scrollIntoViewIfNeeded(); await open.focus(); await page.keyboard.press("Enter");
  const dlg = page.getByRole("dialog"); await expect(dlg).toBeVisible();
  const inside: boolean[] = [];
  for (let i = 0; i < 15; i++) { await page.keyboard.press("Tab"); inside.push(await dlg.evaluate((d) => d.contains(document.activeElement))); }
  await page.keyboard.press("Escape"); const closed = await dlg.isHidden();
  const restored = await page.evaluate(() => (document.activeElement?.textContent ?? "").trim());
  const reducedMotionRules = await page.evaluate(() => [...document.styleSheets].some((s) => { try { return [...s.cssRules].some((r) => r.cssText.includes("prefers-reduced-motion")); } catch { return false; } }));
  metrics.keyboard = { homeStops: stops, noRingCount: stops.filter((s) => !s.ring).length, dialogTrap: inside.every(Boolean), escapeCloses: closed, focusRestoredTo: restored, reducedMotionRules };
});

// FUX-12: signature dialog does not trap focus and does not restore focus to its opener.
test("FUX-12 known-failing: signature dialog traps Tab and restores focus on Escape", async ({ page }) => {
  test.fail(true, "FUX-12: Tab leaves the aria-modal dialog; focus lands on 'Documents' after Escape");
  await page.goto("/");
  await page.getByTestId("file-input").setInputFiles(F("multifont.pdf"));
  await expect(page.getByTestId("status-page")).toHaveText("Page 1 of 1");
  const open = page.getByRole("button", { name: /Create signature/ }).first(); await open.scrollIntoViewIfNeeded(); await open.focus(); await page.keyboard.press("Enter");
  const dlg = page.getByRole("dialog"); await expect(dlg).toBeVisible();
  for (let i = 0; i < 15; i++) { await page.keyboard.press("Tab"); expect(await dlg.evaluate((d) => d.contains(document.activeElement))).toBe(true); }
  await page.keyboard.press("Escape"); await expect(dlg).toBeHidden();
  await expect(open).toBeFocused();
});

// FUX-13: at 200% scaling of a 1366x768 screen (683x384 CSS px) the toolbar clips Organize/Search/Theme with no overflow menu.
test("FUX-13 known-failing: toolbar controls stay reachable at 200% scaling", async ({ browser }) => {
  test.fail(true, "FUX-13: toolbar overflows; right-hand controls are clipped (evidence/visual-editor-longname-683x384@200.png)");
  const ctx = await browser.newContext({ viewport: { width: 683, height: 384 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage(); await page.goto("/");
  await page.getByTestId("file-input").setInputFiles(F("multifont.pdf"));
  await expect(page.getByTestId("status-page")).toHaveText("Page 1 of 1");
  const tb = page.getByRole("toolbar", { name: "Document toolbar" });
  const clipped = await tb.evaluate((t) => [...t.querySelectorAll("button,select,input")].filter((b) => { const r = (b as HTMLElement).getBoundingClientRect(); return r.width > 0 && r.right > window.innerWidth; }).map((b) => (b.getAttribute("aria-label") || b.textContent || "").trim()));
  metrics.fux13_clipped = clipped;
  expect(clipped).toEqual([]);
  await ctx.close();
});
