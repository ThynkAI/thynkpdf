import { test, expect } from "@playwright/test";
import { apiUp, signInAndUpload, LOCAL_FIXTURE } from "./helpers";

test.describe("slice 3 (live backend)", () => {
  test.beforeEach(async ({ request }) => { test.skip(!(await apiUp(request)), "backend not running"); });

  test("text edit replaces text in the PDF and reports errors with hints", async ({ page }) => {
    await signInAndUpload(page);
    await expect(page.getByLabel("Find text")).toBeEnabled();
    await page.getByLabel("Find text").fill("ACME-001");
    await page.getByLabel("Replacement text").fill("EDIT-777");
    await page.getByRole("button", { name: "Replace", exact: true }).click();
    await expect(page.getByTestId("text-edit-result")).toHaveText("Replaced 1 occurrence on page 1.");
    await expect(page.getByTestId("version-id")).toHaveText(/^v2 /);
    await expect(page.locator('.tp-viewer [data-page="1"] .textLayer')).toContainText("EDIT-777");
    await page.getByLabel("Find text").fill("does-not-exist");
    await page.getByRole("button", { name: "Replace", exact: true }).click();
    await expect(page.getByTestId("error")).toContainText("TEXT_NOT_FOUND");
    await expect(page.getByTestId("error")).toContainText("split across runs");
  });

  test("organizer: keyboard reorder, rotate selected, extract and open new doc", async ({ page }) => {
    await signInAndUpload(page);
    await page.getByRole("button", { name: "Organize pages" }).click();
    const dlg = page.getByRole("dialog");
    await expect(dlg.getByRole("button", { name: "Delete", exact: true })).toBeDisabled(); // nothing selected
    await dlg.getByTestId("org-page-1").focus();
    await page.keyboard.press("Alt+ArrowRight");
    await expect(page.getByTestId("version-id")).toHaveText(/^v2 /);
    await expect(page.locator('.tp-viewer [data-page="2"] .textLayer')).toContainText("P1");
    await expect(dlg.getByTestId("org-page-2")).toBeFocused();
    await dlg.getByTestId("org-page-3").click();
    await dlg.getByRole("button", { name: "⟳ Rotate right" }).click();
    await expect(page.getByTestId("version-id")).toHaveText(/^v3 /);
    await dlg.getByTestId("org-page-1").click();
    await dlg.getByTestId("org-page-2").click();
    await dlg.getByRole("button", { name: "Extract to new PDF" }).click();
    await expect(dlg.getByTestId("created-docs")).toContainText("2 pages");
    await dlg.getByTestId("created-docs").getByRole("button", { name: "Open" }).first().click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page.getByTestId("status-page")).toHaveText("Page 1 of 2");
  });

  test("organizer: split by ranges and merge with another document", async ({ page }) => {
    await signInAndUpload(page);
    await page.getByRole("button", { name: "Organize pages" }).click();
    const dlg = page.getByRole("dialog");
    await dlg.getByLabel("Split into new PDFs").fill("1-5");
    await dlg.getByRole("button", { name: "Split", exact: true }).click();
    await expect(dlg.getByRole("alert")).toContainText("outside 1–3");
    await dlg.getByLabel("Split into new PDFs").fill("1, 2-3");
    await dlg.getByRole("button", { name: "Split", exact: true }).click();
    await expect(dlg.getByTestId("created-docs").locator("li")).toHaveCount(2);
    await dlg.getByTestId("merge-list").locator("input").first().check();
    await dlg.getByRole("button", { name: "Merge (current first)" }).click();
    await expect(dlg.getByTestId("created-docs").locator("li")).toHaveCount(3);
    await dlg.getByTestId("created-docs").getByRole("button", { name: "Open" }).first().click();
    await expect(page.getByTestId("doc-title")).toHaveText("merged.pdf");
    await expect(page.getByTestId("status-page")).toHaveText(/Page 1 of [4-9]/);
  });

  test("local docs: organizer and text edit explain why they are disabled", async ({ page }) => {
    await page.goto("/");
    await page.getByTestId("file-input").setInputFiles(LOCAL_FIXTURE);
    await expect(page.getByTestId("text-edit-reason")).toContainText("server");
    await page.getByRole("button", { name: "Organize pages" }).click();
    await expect(page.getByRole("button", { name: "Extract to new PDF" })).toBeDisabled();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
  });
});
