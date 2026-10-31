import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { LOCAL_FIXTURE } from "./helpers";

const TILES = ["edit", "merge-split", "compress", "sign", "forms", "comment", "ai", "documents"];
const axe = async (page: Page) => (await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze()).violations.map((v) => `${v.id}: ${v.nodes.slice(0, 3).map((n) => n.target.join(" ")).join(" | ")}`);
/** Visual sanity: nothing scrolls sideways and the given regions don't overlap. */
async function noOverlap(page: Page, ids: string[]) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  const boxes = await Promise.all(ids.map(async (s) => (await page.locator(s).first().boundingBox())!));
  for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
    const a = boxes[i], b = boxes[j];
    const overlap = a.x < b.x + b.width - 1 && b.x < a.x + a.width - 1 && a.y < b.y + b.height - 1 && b.y < a.y + a.height - 1;
    expect(overlap, `${ids[i]} overlaps ${ids[j]}`).toBe(false);
  }
}

test("home: 8 tool tiles matching ?tool= ids, accessible, screenshot", async ({ page }, info) => {
  await page.goto("/");
  for (const t of TILES) await expect(page.getByTestId(`home-tile-${t}`)).toBeVisible();
  expect(await axe(page)).toEqual([]);
  await page.evaluate(() => document.documentElement.classList.add("dark"));
  expect(await axe(page)).toEqual([]);
  await info.attach("home", { body: await page.screenshot(), contentType: "image/png" });
  await page.getByTestId("home-tile-documents").click();
  await expect(page).toHaveURL(/\/documents/);
});

test("home tile asks for a file, then opens the tool with its sub-toolbar", async ({ page }) => {
  await page.goto("/");
  const chooser = page.waitForEvent("filechooser");
  await page.getByTestId("home-tile-sign").click();
  await (await chooser).setFiles(LOCAL_FIXTURE);
  await expect(page.getByTestId("home")).toHaveCount(0);
  await expect(page.getByRole("toolbar", { name: "Sign tool" })).toBeVisible();
  await expect(page.locator("#sign-h")).toBeFocused();
  await page.getByRole("button", { name: "Close Sign tool" }).click();
  await expect(page.getByTestId("context-bar")).toHaveCount(0);
});

test("editor layout: menu row, left tabs, right tools pane; no overlap; accessible", async ({ page }, info) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await page.getByTestId("file-input").setInputFiles(LOCAL_FIXTURE);
  await expect(page.getByTestId("status-page")).toHaveText("Page 1 of 12");
  await noOverlap(page, ["header", '[aria-label="Left sidebar"]', "main", '[aria-label="Right panel"]']);
  // tools pane switches tools and shows the matching sub-toolbar
  await page.getByRole("button", { name: "Tool: Forms" }).click();
  await expect(page.getByRole("toolbar", { name: "Forms tool" })).toBeVisible();
  await page.getByRole("button", { name: "Tool: Comment" }).click();
  await expect(page.getByRole("toolbar", { name: "Annotation tools" })).toBeVisible();
  await expect(page.getByTestId("context-bar")).toHaveCount(0);
  // left panel tabs
  await page.getByRole("tab", { name: "Bookmarks" }).click();
  await expect(page.getByTestId("no-bookmarks").or(page.getByTestId("bookmarks"))).toBeVisible();
  await page.getByRole("tab", { name: "Comments" }).click();
  await expect(page.getByRole("tabpanel")).toContainText(/No comments yet|p\d/);
  await page.getByRole("tab", { name: "Pages" }).click();
  await expect(page.getByRole("region", { name: "Page thumbnails" })).toBeVisible();
  expect(await axe(page)).toEqual([]);
  await info.attach("editor", { body: await page.screenshot(), contentType: "image/png" });
  // Home from the menu row comes back over the open document
  await page.getByRole("button", { name: "Home", exact: true }).click();
  await expect(page.getByTestId("home")).toBeVisible();
});
