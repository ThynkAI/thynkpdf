import { test, expect } from "@playwright/test";
import path from "node:path";
import AxeBuilder from "@axe-core/playwright";
import { apiUp, openWorkspaceAndUpload } from "./helpers";
const axe = async (p: import("@playwright/test").Page) => (await new AxeBuilder({ page: p }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze()).violations.map((v) => `${v.id}: ${v.nodes.slice(0, 3).map((n) => n.target.join(" ")).join(" | ")}`);

const FORM = path.join(path.dirname(new URL(import.meta.url).pathname), "..", "fixtures", "form-fields.pdf");

test.describe("phase 2 (live backend)", () => {
  test.beforeEach(async ({ request }) => { test.skip(!(await apiUp(request)), "backend not running"); });

  test("organizer: duplicate, insert blank, delete (with confirmation) as new versions", async ({ page }) => {
    await openWorkspaceAndUpload(page);
    await page.getByRole("button", { name: "Organize pages" }).click();
    const dlg = page.getByRole("dialog");
    await dlg.getByTestId("org-page-1").click();
    await dlg.getByRole("button", { name: "Duplicate" }).click();
    await expect(page.getByTestId("version-id")).toHaveText(/^v2 /);
    await expect(page.getByTestId("status-page")).toHaveText(/of 4$/);
    await dlg.getByRole("button", { name: "Insert blank page" }).click();
    await expect(page.getByTestId("version-id")).toHaveText(/^v3 /);
    await expect(page.getByTestId("status-page")).toHaveText(/of 5$/);
    await dlg.getByTestId("org-page-2").click();
    await dlg.getByTestId("org-page-3").click();
    await dlg.getByRole("button", { name: "Delete", exact: true }).click();
    await expect(dlg.getByRole("group", { name: "Confirm delete" })).toContainText("Delete 2 pages?");
    await dlg.getByRole("button", { name: "Confirm delete" }).click();
    await expect(page.getByTestId("version-id")).toHaveText(/^v4 /);
    await expect(page.getByTestId("status-page")).toHaveText(/of 3$/);
  });

  test("server forms: fill and flatten as new versions", async ({ page }) => {
    await openWorkspaceAndUpload(page, FORM, 1);
    const ff = page.getByTestId("form-fields");
    await ff.getByLabel("full_name").fill("Grace Hopper");
    await ff.getByRole("button", { name: "Save values (new version)" }).click();
    await expect(page.getByTestId("version-id")).toHaveText(/^v2 /);
    await expect(page.getByTestId("form-fields").getByLabel("full_name")).toHaveValue("Grace Hopper");
    await page.getByRole("button", { name: "Flatten form…" }).click();
    await page.getByRole("group", { name: "Confirm flatten" }).getByRole("button", { name: "Flatten" }).click();
    await expect(page.getByTestId("version-id")).toHaveText(/^v3 /);
    await expect(page.getByTestId("no-fields")).toBeVisible();
  });

  test("request signature → one-time link → signer completes → signed version; edits then show DOCUMENT_SIGNED; audit", async ({ page, context }) => {
    await openWorkspaceAndUpload(page);
    await page.getByRole("button", { name: "Request signatures" }).click();
    const rp = page.getByTestId("request-panel");
    await rp.getByLabel("Request title").fill("E2E contract");
    await rp.getByLabel("Signer 1 name").fill("Sam Signer");
    await rp.getByLabel("Signer 1 email").fill("sam.signer@example.com");
    await rp.getByRole("button", { name: /^Create request/ }).click();
    await expect(rp.getByTestId("signer-links")).toContainText("No email is sent");
    await expect(rp.getByTestId("signer-links")).toContainText("only once");
    await expect(rp.getByRole("button", { name: "Copy link for sam.signer@example.com" })).toBeVisible();
    const link = (await rp.getByTestId("signer-link").textContent())!;
    await expect(rp.getByTestId("request-status")).toHaveText("pending");
    expect(await axe(page)).toEqual([]);

    const sctx = await context.browser()!.newContext(); // separate context: no account/session
    const signer = await sctx.newPage();
    await signer.goto(link);
    await expect(signer.getByText("Hello")).toContainText("Sam Signer");
    await expect(signer.getByTestId("sign-field").first()).toBeVisible();
    await expect(signer.getByRole("button", { name: "Sign document" })).toBeDisabled();
    expect(await axe(signer)).toEqual([]);
    await signer.getByTestId("consent-text").click();
    await signer.getByRole("button", { name: "Sign document" }).click();
    await expect(signer.getByTestId("sign-done")).toContainText("all parties have signed");
    await sctx.close();

    await rp.getByRole("button", { name: "I have copied the links" }).click();
    await page.getByRole("button", { name: "Request signatures" }).click();
    await page.getByRole("button", { name: "Request signatures" }).click();
    await expect(page.getByTestId("request-status")).toHaveText("completed");
    await page.getByRole("button", { name: "Open signed version" }).click();
    await expect(page.getByTestId("version-id")).toHaveText(/^v2 /);
    await expect(page.getByTestId("status-page")).toHaveText(/of 4$/); // certificate page appended
    // capabilities already disable page ops on a signed version …
    await expect(page.getByRole("button", { name: /Rotate page/ }).first()).toBeDisabled();
    // … and an ungated versioned op gets 409 DOCUMENT_SIGNED, reported distinctly from a version conflict.
    await page.getByLabel("New field name").fill("late_field");
    await page.getByRole("button", { name: /^Add to page/ }).click();
    await expect(page.getByTestId("error")).toContainText("DOCUMENT_SIGNED");
    await expect(page.getByTestId("error")).not.toContainText("Conflict");
    await page.getByRole("button", { name: "Audit trail" }).click();
    const audit = page.getByTestId("audit-panel");
    await expect(audit.getByTestId("audit-row").filter({ hasText: "completed" })).not.toHaveCount(0);
    await expect(audit.getByTestId("sig-verify")).toContainText("untrusted certificate");
  });

  test("AI panel is labelled as excerpt/stub mode and links to pages", async ({ page }) => {
    await openWorkspaceAndUpload(page);
    await expect(page.getByTestId("ai-mode")).toContainText("Excerpt mode");
    await page.getByRole("button", { name: "Key excerpts (summary)" }).click();
    const ans = page.getByTestId("ai-answer");
    await expect(ans).toBeVisible();
    await expect(page.getByTestId("ai-mode")).toContainText("Excerpt mode");
    const ref = ans.getByRole("button", { name: /^p\.\d+$/ }).first();
    if (await ref.count()) { await ref.click(); }
  });

  test("AI 429 RATE_LIMITED shows a retry countdown", async ({ page }) => {
    await openWorkspaceAndUpload(page);
    await page.route("**/ai/ask", (r) => r.fulfill({ status: 429, contentType: "application/json", body: JSON.stringify({ error: { code: "RATE_LIMITED", message: "slow down", details: { retry_after: 3, limit_per_minute: 20 } } }) }));
    await page.getByLabel("Question about the document").fill("total?");
    await page.getByRole("button", { name: "Ask", exact: true }).click();
    await expect(page.getByRole("alert").filter({ hasText: "Too many requests" })).toContainText("retry in 3 s");
    await expect(page.getByTestId("ai-wait")).toBeVisible();
    await expect(page.getByRole("button", { name: "Ask", exact: true })).toBeDisabled();
    await expect(page.getByTestId("ai-wait")).toHaveCount(0, { timeout: 6000 });
  });
});
