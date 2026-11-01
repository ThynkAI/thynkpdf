import { test, expect, type Page } from "@playwright/test";
import path from "node:path";
import { readFileSync } from "node:fs";
const __dirname = path.dirname(new URL(import.meta.url).pathname);
const FIXTURE = path.join(__dirname, "..", "fixtures", "sample-12p.pdf");
const BACKEND_FIXTURE = path.join(__dirname, "..", "..", "backend-tests", "fixtures", "simple-3page.pdf");
const API = process.env.THYNKPDF_API_URL ?? "http://localhost:8000";
import { workspaceToken, offline } from "./helpers";

async function openLocal(page: Page) {
  await offline(page);
  await page.goto("/");
  await page.getByTestId("file-input").setInputFiles(FIXTURE);
  await expect(page.getByTestId("status-page")).toHaveText("Page 1 of 12");
  await expect(page.locator(".tp-viewer canvas").first()).toBeVisible();
}

test("shell renders with wordmark, theme toggle", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByLabel("THYNKPDF").first()).toBeVisible();
  const dark = await page.evaluate(() => document.documentElement.classList.contains("dark"));
  await page.getByRole("button", { name: /Switch to (dark|light) theme/ }).click();
  expect(await page.evaluate(() => document.documentElement.classList.contains("dark"))).toBe(!dark);
});

test("opens a real PDF locally: virtualization, high-DPI canvas, text layer, navigation, zoom", async ({ page }) => {
  await openLocal(page);
  // virtualized: far fewer than 12 page canvases mounted in main viewer
  expect(await page.locator(".tp-viewer .tp-page").count()).toBeLessThan(12);
  // high-DPI: backing store = 2x CSS width
  const [ratio, dpr] = await page.locator(".tp-viewer canvas").first().evaluate((c: HTMLCanvasElement) => [c.width / c.getBoundingClientRect().width, window.devicePixelRatio]);
  expect(ratio).toBeCloseTo(dpr, 1);
  await expect(page.locator('.tp-viewer [data-page="1"] .textLayer span').first()).toBeVisible();
  await expect(page.locator('.tp-viewer [data-page="1"] .textLayer')).toContainText("Page 1 heading");
  // keyboard navigation
  await page.getByTestId("viewer-scroll").click({ position: { x: 5, y: 5 } });
  await page.keyboard.press("End");
  await expect(page.getByTestId("status-page")).toHaveText("Page 12 of 12");
  await expect(page.locator('.tp-viewer [data-page="12"] canvas')).toBeVisible();
  await page.keyboard.press("Home");
  await expect(page.getByTestId("status-page")).toHaveText("Page 1 of 12");
  // thumbnails
  await page.getByRole("button", { name: "Go to page 2" }).click();
  await expect(page.getByTestId("status-page")).toHaveText("Page 2 of 12");
  // zoom
  await page.getByLabel("Zoom", { exact: true }).selectOption("2");
  await expect(page.getByTestId("status-zoom")).toHaveText("200%");
  await page.keyboard.press("Control+-");
  await expect(page.getByTestId("status-zoom")).toHaveText("175%");
  await page.keyboard.press("Control+9");
  await expect(page.getByTestId("status-zoom")).toContainText("fit page");
});

test("search across pages with highlights and next/prev", async ({ page }) => {
  await openLocal(page);
  await page.keyboard.press("Control+f");
  await expect(page.getByLabel("Search document")).toBeFocused();
  await page.getByLabel("Search document").fill("needle");
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("search-count")).toHaveText("1 of 3 matches");
  await expect(page.getByTestId("status-page")).toHaveText("Page 2 of 12");
  await expect(page.locator('.tp-viewer [data-page="2"] mark.tp-hit')).toHaveText("needle");
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("search-count")).toHaveText("2 of 3 matches");
  await expect(page.getByTestId("status-page")).toHaveText("Page 6 of 12");
  // active match is styled distinctly; only one active at a time
  await expect(page.locator('.tp-viewer [data-page="6"] mark.tp-hit-active')).toHaveCount(1);
  await expect(page.locator(".tp-viewer mark.tp-hit-active")).toHaveCount(1);
  const bg = await page.locator(".tp-viewer mark.tp-hit-active").evaluate((m) => getComputedStyle(m).backgroundColor);
  expect(bg).toBe("rgba(234, 88, 12, 0.6)"); // inactive hits are rgba(250, 204, 21, 0.45)
});

test("local documents can be edited in the browser with no account", async ({ page }) => {
  await openLocal(page);
  await expect(page.getByLabel("Rotate page clockwise")).toBeEnabled();
  await expect(page.getByTestId("thumb-1")).toHaveAttribute("draggable", "true");
  await page.getByLabel("Rotate page clockwise").click();
  await expect(page.getByTestId("undo-btn")).toBeEnabled();
  await expect(page.locator("body")).not.toContainText(/sign in/i);
});

test("drag and drop opens a PDF", async ({ page }) => {
  await offline(page);
  await page.goto("/");
  const b64 = readFileSync(FIXTURE).toString("base64");
  const dt = await page.evaluateHandle((data) => {
    const bytes = Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
    const t = new DataTransfer(); t.items.add(new File([bytes], "dropped.pdf", { type: "application/pdf" })); return t;
  }, b64);
  await page.dispatchEvent("main", "dragover", { dataTransfer: dt });
  await page.dispatchEvent("main", "drop", { dataTransfer: dt });
  await expect(page.getByTestId("status-page")).toHaveText("Page 1 of 12");
  await expect(page.getByTestId("doc-title")).toHaveText("dropped.pdf");
});

async function openWorkspaceAndUpload(page: Page) {
  await page.goto("/");
  await expect(page.getByTestId("backend-status")).toHaveText("Connected");
  await page.getByTestId("file-input").setInputFiles(BACKEND_FIXTURE);
  await expect(page.getByTestId("status-page")).toHaveText("Page 1 of 3");
  await expect(page.getByText("Source: backend")).toBeVisible();
  await expect(page.getByTestId("version-id")).toHaveText(/^v1 /);
  await expect(page.getByRole("button", { name: "Rotate page clockwise" })).toBeEnabled();
}

test.describe("live backend", () => {
  test.beforeEach(async ({ request }) => {
    const up = await request.get(API + "/health").then((r) => r.ok(), () => false);
    test.skip(!up, "backend not running");
  });

test("upload -> open -> rotate -> reload persisted", async ({ page }) => {
  await openWorkspaceAndUpload(page);
  const p1 = page.locator('.tp-viewer [data-page="1"]');
  const before = await p1.boundingBox();
  expect(before!.height).toBeGreaterThan(before!.width);
  await page.getByRole("button", { name: "Rotate page clockwise" }).click();
  await expect(page.getByTestId("version-id")).toHaveText(/^v2 /);
  await expect.poll(async () => { const b = await p1.boundingBox(); return b!.width > b!.height; }).toBe(true);
  await expect(page.locator('.tp-viewer [data-page="1"] .textLayer')).toContainText("Invoice");
});

test("drag thumbnail to reorder persists via backend", async ({ page }) => {
  await openWorkspaceAndUpload(page);
  await expect(page.getByTestId("thumb-1")).toHaveAttribute("draggable", "true");
  await page.getByTestId("thumb-1").dragTo(page.getByTestId("thumb-3"));
  await expect(page.getByTestId("version-id")).toHaveText(/^v2 /);
  await expect(page.locator('.tp-viewer [data-page="1"] .textLayer')).toContainText("P2");
  await expect(page.locator('.tp-viewer [data-page="3"] .textLayer')).toContainText("P1");
});

test("409 conflict shows message and reloads latest version", async ({ page, request }) => {
  await openWorkspaceAndUpload(page);
  // Change the document behind the UI's back.
  const tok = { access_token: await workspaceToken(page, request) };
  const docId = await page.evaluate(() => JSON.parse(sessionStorage.getItem("tp-session-v2")!).lastDocumentId as string);
  const r = await request.post(API + "/pdf/pages/rotate", { headers: { Authorization: `Bearer ${tok.access_token}` }, data: { document_id: docId, expected_version: 1, pages: [3], angle: 180 } });
  expect(r.ok()).toBe(true);
  await page.getByRole("button", { name: "Rotate page clockwise" }).click();
  await expect(page.getByTestId("error")).toContainText("Conflict: this document was changed elsewhere (you had v1, server has v2)");
  await expect(page.getByTestId("version-id")).toHaveText(/^v2 /);
  // retry now succeeds
  await page.getByRole("button", { name: "Rotate page clockwise" }).click();
  await expect(page.getByTestId("version-id")).toHaveText(/^v3 /);
});

test("session and last document survive a page reload", async ({ page }) => {
  await openWorkspaceAndUpload(page);
  await page.reload();
  await expect(page.getByTestId("backend-status")).toHaveText("Connected");
  await expect(page.getByTestId("doc-title")).toHaveText("simple-3page.pdf");
  await expect(page.getByTestId("version-id")).toHaveText(/^v1 /);
  await expect(page.getByRole("button", { name: "Rotate page clockwise" })).toBeEnabled();
});
});
