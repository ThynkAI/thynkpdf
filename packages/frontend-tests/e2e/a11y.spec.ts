import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { LOCAL_FIXTURE } from "./helpers";

async function axe(page: Page, include?: string) {
  let b = new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .exclude(".textLayer"); // PDF.js transparent text spans are intentionally invisible (selection layer)
  if (include) b = b.include(include);
  const r = await b.analyze();
  const summary = r.violations.map((v) => `${v.id} (${v.impact}): ${v.nodes.length} — ${v.nodes.slice(0, 3).map((n) => n.target.join(" ")).join(" | ")}`);
  expect(summary, summary.join("\n")).toEqual([]);
}

test("editor empty state has no axe violations (light + dark)", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("toolbar", { name: "Document toolbar" })).toBeVisible();
  await axe(page);
  await page.getByRole("button", { name: /Switch to (dark|light) theme/ }).click();
  await axe(page);
});

test("editor with a document, organizer and signature dialogs have no axe violations", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("file-input").setInputFiles(LOCAL_FIXTURE);
  await expect(page.locator(".tp-viewer canvas").first()).toBeVisible();
  await axe(page);
  if (await page.getByRole("button", { name: "Organize pages" }).isVisible()) {
    await page.getByRole("button", { name: "Organize pages" }).click();
    await axe(page, '[role="dialog"]');
    await page.getByRole("button", { name: "Close organizer" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
  }
  if (await page.getByRole("button", { name: "Annotate" }).isVisible()) {
    await page.getByRole("button", { name: "Annotate" }).click();
    await expect(page.getByRole("toolbar", { name: "Annotation tools" })).toBeVisible();
    await axe(page, '[aria-label="Annotation tools"]');
  }
  await page.getByRole("button", { name: "Search" }).click();
  await page.getByRole("button", { name: "Create signature" }).click();
  await axe(page, '[role="dialog"]');
});

test("documents dashboard (signed-out view) has no axe violations", async ({ page }) => {
  await page.goto("/documents");
  await expect(page.getByRole("heading", { name: "Documents" })).toBeVisible();
  await axe(page);
});

test("brand: header logo, favicons and red primary accent (light + dark Home has no axe violations)", async ({ page, request }) => {
  await page.goto("/");
  const logo = page.locator('header img[src="/logo.svg"]');
  await expect(logo).toBeVisible();
  expect(await logo.evaluate((i: HTMLImageElement) => i.complete && i.naturalWidth > 0)).toBe(true);
  for (const href of ["/favicon.ico", "/icon-192.png", "/icon-512.png", "/apple-touch-icon.png", "/logo.svg"]) {
    expect((await request.get(href)).status(), href).toBe(200);
  }
  await expect(page.locator('link[rel="icon"][href^="/favicon.ico"]')).toHaveCount(1);
  await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveCount(1);
  await expect(page.getByTestId("home")).toBeVisible();
  await axe(page, '[data-testid="home"]');
  await page.getByRole("button", { name: /Switch to (dark|light) theme/ }).click();
  await axe(page, '[data-testid="home"]');
});
