import { test, expect } from "@playwright/test";
import { apiUp, EMAIL, PASSWORD, BACKEND_FIXTURE } from "./helpers";

test.describe("documents dashboard (live backend)", () => {
  test.beforeEach(async ({ request }) => { test.skip(!(await apiUp(request)), "backend not running"); });

  test("sign in, upload, filter, open, edit, view old version read-only", async ({ page }) => {
    await page.goto("/documents");
    await page.getByLabel("Username").fill(EMAIL);
    await page.getByLabel("Password").fill(PASSWORD);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page.getByTestId("doc-table")).toBeVisible();
    const name = `dash-${Date.now()}.pdf`;
    const { readFileSync } = await import("node:fs");
    await page.getByTestId("dash-file-input").setInputFiles({ name, mimeType: "application/pdf", buffer: readFileSync(BACKEND_FIXTURE) });
    await page.getByLabel("Filter documents by name").fill(name);
    await expect(page.getByTestId("doc-table").locator("tbody tr")).toHaveCount(1);
    await expect(page.getByRole("status")).toContainText(/^1 of \d+ documents/);
    // blocked features are visibly disabled, not fake
    await expect(page.getByRole("button", { name: `Star ${name} (unavailable)` })).toBeDisabled();
    await page.getByRole("link", { name }).click();
    await expect(page.getByTestId("doc-title")).toHaveText(name);
    await expect(page.getByTestId("version-id")).toHaveText(/^v1 /);
    await page.getByRole("button", { name: "Rotate page clockwise" }).click();
    await expect(page.getByTestId("version-id")).toHaveText(/^v2 /);
    await page.getByRole("link", { name: "Documents" }).click();
    await page.getByLabel("Filter documents by name").fill(name);
    await page.getByRole("button", { name: "Versions" }).click();
    await expect(page.getByTestId("versions").locator("li")).toHaveCount(2);
    await page.getByRole("link", { name: "View (read-only)" }).click();
    await expect(page.getByTestId("notice")).toContainText("Viewing v1");
    await expect(page.getByTestId("version-id")).toHaveText("local only");
    await expect(page.getByRole("button", { name: /Rotate page — unavailable/ })).toBeDisabled();
  });
});
