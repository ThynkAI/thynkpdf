import { test, expect } from "@playwright/test";
import { apiUp, signInAndUpload, LOCAL_FIXTURE } from "./helpers";

test("?tool= opens the matching tool; unknown values are ignored", async ({ page }) => {
  await page.goto("/?tool=merge-split");
  await page.getByTestId("file-input").setInputFiles(LOCAL_FIXTURE);
  await expect(page.getByRole("dialog", { name: "Organize pages" })).toBeVisible();
  await page.goto("/?tool=compress");
  await expect(page.getByTestId("compress-section")).toContainText("sign in and open a server document");
  await page.goto("/?tool=comment");
  await page.getByTestId("file-input").setInputFiles(LOCAL_FIXTURE);
  await expect(page.getByRole("toolbar", { name: "Annotation tools" })).toBeVisible();
  await expect(page.locator("#cm-h")).toBeFocused();
  await page.goto("/?tool=forms");
  await page.getByTestId("file-input").setInputFiles(LOCAL_FIXTURE);
  await expect(page.locator("#forms-h")).toBeFocused();
  await page.goto("/?tool=annotate"); // desktop launcher id
  await page.getByTestId("file-input").setInputFiles(LOCAL_FIXTURE);
  await expect(page.getByRole("toolbar", { name: "Annotation tools" })).toBeVisible();
  await page.goto("/?tool=merge"); // desktop launcher id
  await page.getByTestId("file-input").setInputFiles(LOCAL_FIXTURE);
  await expect(page.getByRole("dialog", { name: "Organize pages" })).toBeVisible();
  await page.goto("/?tool=nonsense");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByRole("toolbar", { name: "Annotation tools" })).toHaveCount(0);
  await page.goto("/?tool=documents");
  await expect(page).toHaveURL(/\/documents$/);
});

test.describe("live backend", () => {
  test.beforeEach(async ({ request }) => { test.skip(!(await apiUp(request)), "backend not running"); });
  test("?tool=compress compresses a server document as a new version", async ({ page }) => {
    await signInAndUpload(page);
    await page.goto("/?tool=compress");
    await expect(page.getByTestId("doc-title")).toHaveText("simple-3page.pdf"); // session + last doc restored
    const sec = page.getByTestId("compress-section");
    await sec.getByRole("button", { name: "Compress" }).click();
    await expect(sec.getByTestId("compress-result")).toContainText(/Compressed|Already compact/);
  });
});
