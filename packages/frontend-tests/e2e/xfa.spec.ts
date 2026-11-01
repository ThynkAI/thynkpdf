import { test, expect } from "@playwright/test";
import { offline } from "./helpers";
import path from "node:path";
const fx = (n: string) => path.join(path.dirname(new URL(import.meta.url).pathname), "..", "fixtures", n);

test("dynamic XFA form renders (not the 'Please wait… Adobe Reader' placeholder), is fillable, and saves", async ({ page }) => {
  await offline(page);
  await page.goto("/");
  await page.getByTestId("file-input").setInputFiles(fx("xfa-dynamic.pdf"));
  const layer = page.getByTestId("xfa-layer").first();
  await expect(layer).toContainText("XFA Test Application");
  await expect(page.getByTestId("viewer-scroll")).not.toContainText("Please wait");
  await expect(page.getByTestId("xfa-banner")).toHaveAttribute("data-xfa", "pure");
  const viewer = page.getByTestId("viewer-scroll");
  const name = viewer.locator("input.xfaTextfield").first();
  await expect(name).toHaveValue("Jane Prefilled");
  const city = viewer.locator("input.xfaTextfield").nth(1);
  await city.fill("Guelph");
  await city.press("Tab"); // XFA layer commits to annotationStorage on change/blur
  await expect(page.getByTestId("xfa-forms")).toBeVisible();
  await expect(page.getByTestId("xfa-form-banner")).toContainText("Dynamic XFA form");
  await page.getByTestId("xfa-forms").getByRole("button", { name: "Save filled copy" }).click();
  await expect(page.getByTestId("doc-title")).toHaveText("xfa-dynamic-filled.pdf");
  // Reloaded from the saved bytes: the value lives in the XFA datasets now.
  await expect(viewer.locator("input.xfaTextfield").nth(1)).toHaveValue("Guelph");
});

test("hybrid XFA + AcroForm shows the AcroForm fallback and an honest banner", async ({ page }) => {
  await offline(page);
  await page.goto("/");
  await page.getByTestId("file-input").setInputFiles(fx("xfa-hybrid.pdf"));
  await expect(page.getByTestId("xfa-banner")).toHaveAttribute("data-xfa", "hybrid");
  await expect(page.getByTestId("xfa-layer")).toHaveCount(0);
  await expect(page.getByTestId("xfa-form-banner")).toHaveAttribute("data-xfa", "hybrid");
  const ff = page.getByTestId("form-fields");
  await ff.getByLabel("form1[0].body[0].FullName[0]").fill("Deep");
  await page.getByRole("button", { name: "Save filled copy" }).click();
  await expect(page.getByTestId("xfa-removed-note")).toContainText("removed the XFA layer");
});
