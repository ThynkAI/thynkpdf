import { test, expect } from "@playwright/test";
import { LOCAL_FIXTURE } from "./helpers";

test("phone layout: panels collapsed, document readable, panels toggle as overlays", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("navigation", { name: "Left sidebar" })).toHaveCount(0);
  await expect(page.getByRole("complementary", { name: "Right panel" })).toHaveCount(0);
  await page.getByTestId("file-input").setInputFiles(LOCAL_FIXTURE);
  await expect(page.getByTestId("status-page")).toHaveText("Page 1 of 12");
  const vw = page.viewportSize()!.width;
  const pg = (await page.locator('.tp-viewer [data-page="1"]').boundingBox())!;
  expect(pg.width).toBeGreaterThan(vw * 0.8); // fit width uses the screen
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.getByRole("button", { name: "Search" }).click();
  await expect(page.getByRole("complementary", { name: "Right panel" })).toBeVisible();
  await page.getByLabel("Search document").fill("needle");
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("search-count")).toHaveText("1 of 3 matches");
  await page.getByRole("button", { name: "Close panel" }).click();
  await page.getByRole("button", { name: "Toggle thumbnails" }).click();
  await expect(page.getByRole("navigation", { name: "Left sidebar" })).toBeVisible();
});
