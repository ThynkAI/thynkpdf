import { expect, type Page, type APIRequestContext } from "@playwright/test";
import path from "node:path";
const here = path.dirname(new URL(import.meta.url).pathname);
export const LOCAL_FIXTURE = path.join(here, "..", "fixtures", "sample-12p.pdf");
export const BACKEND_FIXTURE = path.join(here, "..", "..", "backend-tests", "fixtures", "simple-3page.pdf");
export const API = process.env.THYNKPDF_API_URL ?? "http://localhost:8000";
export const EMAIL = process.env.THYNKPDF_DEV_EMAIL ?? "dev@thynkpdf.dev";
export const PASSWORD = process.env.THYNKPDF_DEV_PASSWORD ?? "ThynkDev-2026!";
export const apiUp = (r: APIRequestContext) => r.get(API + "/health").then((x) => x.ok(), () => false);
export async function signIn(page: Page) {
  await page.goto("/");
  await expect(page.getByTestId("backend-status")).toHaveText(/Online/);
  await page.getByLabel("Username").fill(EMAIL);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByTestId("backend-status")).toHaveText("Connected");
}
export async function signInAndUpload(page: Page, file = BACKEND_FIXTURE, pages = 3) {
  await signIn(page);
  await page.getByTestId("file-input").setInputFiles(file);
  await expect(page.getByTestId("status-page")).toHaveText(`Page 1 of ${pages}`);
  await expect(page.getByTestId("version-id")).toHaveText(/^v1 /);
  await expect(page.getByRole("button", { name: "Rotate page clockwise" })).toBeEnabled();
}

/** Bounding box once layout has settled (page canvases resize as PDF.js renders; CI is slower than dev boxes). */
export async function stableBox(loc: import("@playwright/test").Locator) {
  let prev = await loc.boundingBox();
  for (let i = 0; i < 40; i++) {
    await loc.page().waitForTimeout(100);
    const cur = await loc.boundingBox();
    if (prev && cur && Math.abs(prev.x - cur.x) < 0.5 && Math.abs(prev.y - cur.y) < 0.5 && Math.abs(prev.width - cur.width) < 0.5) return cur;
    prev = cur;
  }
  return prev!;
}
