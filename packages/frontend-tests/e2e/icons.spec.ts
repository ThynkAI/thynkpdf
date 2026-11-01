import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import path from "node:path";
import { apiUp, openWorkspaceAndUpload, LOCAL_FIXTURE, offline } from "./helpers";

// Optional screenshots for PR review: SHOTS_DIR=/abs/dir SHOTS_TAG=before|after.
const SHOTS = process.env.SHOTS_DIR; const TAG = process.env.SHOTS_TAG ?? "after";
const BEFORE = TAG === "before"; // the "before" run only captures screenshots of the old UI
const shot = async (loc: import("@playwright/test").Locator, name: string) => { if (SHOTS) await loc.screenshot({ path: path.join(SHOTS, `${TAG}-${name}.png`) }); };
const TOOL_LABELS = ["Select text", "Highlight (select text)", "Underline (select text)", "Strikethrough (select text)", "Pencil / ink", "Eraser (click an annotation)",
  "Sticky note", "Text comment", "Callout (drag from target to box)", "Rectangle", "Ellipse", "Line", "Arrow", "Stamp"];

async function openAnnotate(page: Page, dark = false) {
  await offline(page);
  if (dark) await page.emulateMedia({ colorScheme: "dark" });
  await page.goto("/");
  await page.getByTestId("file-input").setInputFiles(LOCAL_FIXTURE);
  await expect(page.locator('.tp-viewer [data-page="1"] .textLayer span').first()).toBeVisible();
  await page.getByRole("button", { name: "Annotate" }).click();
  const bar = page.getByRole("toolbar", { name: "Annotation tools" });
  await expect(bar).toBeVisible();
  return bar;
}

test.describe("annotation toolbar icons", () => {
  for (const dark of [false, true]) test(`one consistent icon set, labelled, sized, with active state (${dark ? "dark" : "light"})`, async ({ page }) => {
    const bar = await openAnnotate(page, dark);
    if (dark) await expect(page.locator("html")).toHaveClass(/dark/);
    if (!BEFORE) {
      for (const label of TOOL_LABELS) {
        const b = bar.getByRole("button", { name: label, exact: true });
        await expect(b).toHaveAttribute("title", label);
        await expect(b).toHaveAttribute("aria-label", label);
        const svg = b.locator("svg.lucide");
        await expect(svg).toHaveCount(1);
        const box = (await svg.boundingBox())!;
        expect(Math.round(box.width)).toBeGreaterThanOrEqual(18); expect(Math.round(box.width)).toBeLessThanOrEqual(20);
        expect((await b.textContent())!.trim()).toBe(""); // no Unicode glyphs left
      }
      const pen = bar.getByRole("button", { name: "Pencil / ink" });
      const idle = await pen.evaluate((e) => getComputedStyle(e).backgroundColor);
      await pen.click();
      await expect(pen).toHaveAttribute("aria-pressed", "true");
      await expect.poll(() => pen.evaluate((e) => getComputedStyle(e).backgroundColor)).not.toBe(idle); // transition-colors
      await expect(bar.getByRole("button", { name: "Select text", exact: true })).toHaveAttribute("aria-pressed", "false");
      const v = await new AxeBuilder({ page }).include('[role="toolbar"][aria-label="Annotation tools"]').analyze();
      expect(v.violations).toEqual([]);
    } else await bar.getByRole("button", { name: "Pencil / ink" }).click();
    await shot(bar, `toolbar-${dark ? "dark" : "light"}`);
    await shot(page.locator("body"), `viewer-${dark ? "dark" : "light"}`);
  });
});

test("signed document: one friendly banner, items greyed, raw codes only behind Details", async ({ page, context, request }) => {
  test.skip(!(await apiUp(request)), "backend not running");
  test.setTimeout(120_000);
  await openWorkspaceAndUpload(page);
  // Produce a synthetic signed version with the app's own signing flow (no real documents).
  await page.getByRole("button", { name: "Request signatures" }).click();
  const rp = page.getByTestId("request-panel");
  await rp.getByLabel("Request title").fill("Synthetic test");
  await rp.getByLabel("Signer 1 name").fill("Sam Signer");
  await rp.getByLabel("Signer 1 email").fill("sam.signer@example.com");
  await rp.getByRole("button", { name: /^Create request/ }).click();
  const link = (await rp.getByTestId("signer-link").textContent())!;
  const sctx = await context.browser()!.newContext(); const signer = await sctx.newPage();
  await signer.goto(link); await signer.getByTestId("consent-text").click();
  await signer.getByRole("button", { name: "Sign document" }).click();
  await expect(signer.getByTestId("sign-done")).toBeVisible(); await sctx.close();
  await rp.getByRole("button", { name: "I have copied the links" }).click();
  await page.getByRole("button", { name: "Request signatures" }).click();
  await page.getByRole("button", { name: "Request signatures" }).click();
  await expect(page.getByTestId("request-status")).toHaveText("completed");
  await page.getByRole("button", { name: "Open signed version" }).click();
  await expect(page.getByTestId("version-id")).toHaveText(/^v2 /);
  const gates = page.getByTestId("edit-gates");
  await expect(gates.locator("li").first()).not.toContainText("available");
  const editing = page.locator("section", { has: gates });
  await editing.scrollIntoViewIfNeeded();
  if (!BEFORE) {
    await expect(page.getByTestId("notice-SIGNED_DOCUMENT")).toHaveCount(1);
    await expect(page.getByTestId("notice-SIGNED_DOCUMENT")).toContainText("This PDF is digitally signed. Editing would break the signature, so editing is turned off.");
    await expect(gates).not.toContainText("SIGNED_DOCUMENT");
    await expect(gates).not.toContainText("invalidate");
    await expect(gates.locator('li[aria-disabled="true"]')).toHaveCount(5);
    await expect(page.locator("aside").getByText("SIGNED_DOCUMENT", { exact: false })).toBeHidden(); // collapsed Details
    await expect(page.locator("aside")).not.toContainText(/FONT_[A-Z_]+ \(/);
    const fonts = page.getByTestId("notice-FONTS");
    if (await fonts.count()) await expect(fonts.first()).toContainText("Some text uses fonts that can't be edited safely.");
  }
  await shot(editing, "signed-editing");
  await shot(page.getByRole("complementary", { name: "Right panel" }), "signed-panel");
  if (!BEFORE) {
    await page.getByTestId("notice-SIGNED_DOCUMENT").getByText("Details").click();
    await expect(page.getByTestId("notice-SIGNED_DOCUMENT")).toContainText("SIGNED_DOCUMENT");
    await shot(editing, "signed-editing-details-open");
  }
});
