import { test, expect, type Page } from "@playwright/test";
import path from "node:path";
import { readFileSync } from "node:fs";
import { PDFDocument, PDFName, PDFDict } from "pdf-lib";
import { apiUp, signInAndUpload, LOCAL_FIXTURE, stableBox } from "./helpers";
const FORM = path.join(path.dirname(new URL(import.meta.url).pathname), "..", "fixtures", "form-fields.pdf");

async function drawAndPlace(page: Page) {
  await page.getByRole("button", { name: "Create signature" }).click();
  await expect(page.getByRole("dialog")).toContainText("not a cryptographic digital signature");
  const c = page.getByTestId("sig-canvas"); const b = (await c.boundingBox())!;
  await page.mouse.move(b.x + 20, b.y + 100); await page.mouse.down();
  for (let i = 1; i <= 10; i++) await page.mouse.move(b.x + 20 + i * 30, b.y + 100 + (i % 2 ? -30 : 30));
  await page.mouse.up();
  await page.getByRole("button", { name: "Use signature" }).click();
  await page.getByRole("button", { name: /^Place on page/ }).click();
  const box = page.getByTestId("sig-box");
  await expect(box).toBeVisible();
  await box.scrollIntoViewIfNeeded();
  await page.getByTestId("viewer-scroll").evaluate((el) => el.scrollBy(0, 150));
  const before = await stableBox(box);
  // move and resize with the mouse
  await page.mouse.move(before.x + before.width / 2, before.y + before.height / 2); await page.mouse.down();
  await page.mouse.move(before.x + before.width / 2 - 60, before.y + before.height / 2 - 40, { steps: 5 }); await page.mouse.up();
  const h = await stableBox(page.getByTestId("sig-resize"));
  await page.mouse.move(h.x + h.width / 2, h.y + h.height / 2); await page.mouse.down();
  await page.mouse.move(h.x + 50, h.y + 10, { steps: 5 }); await page.mouse.up();
  const after = (await box.boundingBox())!;
  expect(after.x).toBeLessThan(before.x - 40);
  expect(after.width).toBeGreaterThan(before.width + 30);
}
const imageCount = async (bytes: Uint8Array, i = 0) => {
  const pdf = await PDFDocument.load(bytes);
  return pdf.getPage(i).node.Resources()?.lookupMaybe(PDFName.of("XObject"), PDFDict)?.keys().length ?? 0;
};

test("local: draw, place, resize, apply visual signature; download contains stamped image", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("file-input").setInputFiles(LOCAL_FIXTURE);
  await expect(page.getByTestId("sig-disclaimer")).toContainText("not a cryptographic");
  await expect(page.getByRole("button", { name: "Request signatures" })).toBeDisabled(); // needs a server document
  await drawAndPlace(page);
  await page.getByRole("button", { name: "Apply signature" }).click();
  await expect(page.getByTestId("doc-title")).toHaveText("sample-12p-signed.pdf");
  await expect(page.getByTestId("sig-box")).toHaveCount(0);
  const [dl] = await Promise.all([page.waitForEvent("download"), page.getByTestId("download-signed").click()]);
  const bytes = new Uint8Array(readFileSync((await dl.path())!));
  expect(await imageCount(bytes)).toBe(1);
  expect(await imageCount(new Uint8Array(readFileSync(LOCAL_FIXTURE)))).toBe(0);
});

test("local: fill form fields and add a new field", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("file-input").setInputFiles(FORM);
  const ff = page.getByTestId("form-fields");
  await expect(ff.getByLabel("full_name")).toBeVisible();
  await ff.getByLabel("full_name").fill("Ada Lovelace");
  await ff.getByLabel("agree").check();
  await ff.getByLabel("country").selectOption("Canada");
  await page.getByRole("button", { name: "Save filled copy" }).click();
  await expect(page.getByTestId("doc-title")).toHaveText("form-fields-filled.pdf");
  await expect(ff.getByLabel("full_name")).toHaveValue("Ada Lovelace");
  await expect(ff.getByLabel("agree")).toBeChecked();
  await page.getByLabel("New field name").fill("notes");
  await page.getByRole("button", { name: "Add to page 1" }).click();
  await expect(page.getByTestId("doc-title")).toHaveText("form-fields-filled-form.pdf");
  await expect(ff.getByLabel("notes")).toBeVisible();
});

test.describe("live backend", () => {
  test.beforeEach(async ({ request }) => { test.skip(!(await apiUp(request)), "backend not running"); });
  test("server doc: signature placed by the server as a new version", async ({ page }) => {
    await signInAndUpload(page);
    await drawAndPlace(page);
    await page.getByRole("button", { name: "Apply signature" }).click();
    await expect(page.getByTestId("version-id")).toHaveText(/^v2 /);
    await expect(page.getByTestId("doc-title")).toHaveText("simple-3page.pdf");
    await expect(page.getByTestId("notice")).toContainText("Signature placed");
    await expect(page.getByText("Source: backend")).toBeVisible();
  });
});
