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
    await page.keyboard.press("Escape");
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
