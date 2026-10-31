import { test, expect, type Page } from "@playwright/test";
import { readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import AxeBuilder from "@axe-core/playwright";
import { apiUp, signIn, signInAndUpload, LOCAL_FIXTURE, stableBox } from "./helpers";
const here = path.dirname(new URL(import.meta.url).pathname);
const PY = path.join(here, "..", ".venv", "bin", "python");
const VERIFY = path.join(here, "..", "scripts", "verify_pdf.py");

async function tool(page: Page, label: RegExp | string) { await page.getByRole("toolbar", { name: "Annotation tools" }).getByRole("button", { name: label }).click(); }
const count = (page: Page) => page.getByTestId("thread-count");
async function layer(page: Page) {
  const l = page.getByTestId("annot-layer-1"); await expect(l).toBeVisible(); return stableBox(l);
}
async function drag(page: Page, x1: number, y1: number, x2: number, y2: number) {
  await page.mouse.move(x1, y1); await page.mouse.down(); await page.mouse.move((x1 + x2) / 2, (y1 + y2) / 2, { steps: 4 }); await page.mouse.move(x2, y2, { steps: 4 }); await page.mouse.up();
}

test("annotations: every tool, identity, threads, resolve/reopen, eraser, save, verify with PDF.js + qpdf + pypdf, reopen", async ({ page }, info) => {
  test.setTimeout(120_000);
  await page.goto("/");
  await page.getByTestId("file-input").setInputFiles(LOCAL_FIXTURE);
  await expect(page.locator('.tp-viewer [data-page="1"] .textLayer span').first()).toBeVisible();
  await page.getByRole("button", { name: "Annotate" }).click();
  await page.getByLabel("Author name").fill("Ada Lovelace");
  await expect(count(page)).toHaveText("(0)");

  // highlight from a real text selection
  await tool(page, /^Highlight/);
  const span = (await page.locator('.tp-viewer [data-page="1"] .textLayer span').first().boundingBox())!;
  await drag(page, span.x + 1, span.y + span.height / 2, span.x + span.width - 1, span.y + span.height / 2);
  await expect(count(page)).toHaveText("(1)");

  await tool(page, "Pencil / ink"); let b = await layer(page); await drag(page, b.x + 60, b.y + 260, b.x + 160, b.y + 300); await expect(count(page)).toHaveText("(2)");
  b = await layer(page); await tool(page, "Rectangle"); await drag(page, b.x + 560, b.y + 110, b.x + 620, b.y + 160); await expect(count(page)).toHaveText("(3)");
  b = await layer(page); await tool(page, "Ellipse"); await drag(page, b.x + 300, b.y + 250, b.x + 380, b.y + 300); await expect(count(page)).toHaveText("(4)");
  b = await layer(page); await tool(page, "Arrow"); await drag(page, b.x + 60, b.y + 340, b.x + 200, b.y + 360); await expect(count(page)).toHaveText("(5)");
  await page.getByLabel("Comment text").fill("Check this paragraph");
  b = await layer(page); await tool(page, "Sticky note"); await page.mouse.click(b.x + 450, b.y + 200); await expect(count(page)).toHaveText("(6)");
  await page.getByLabel("Comment text").fill("Typed comment");
  b = await layer(page); await tool(page, "Text comment"); await page.mouse.click(b.x + 60, b.y + 400); await expect(count(page)).toHaveText("(7)");
  await page.getByLabel("Comment text").fill("See here");
  b = await layer(page); await tool(page, /^Callout/); await drag(page, b.x + 150, b.y + 280, b.x + 420, b.y + 380); await expect(count(page)).toHaveText("(8)");
  await page.getByLabel("Comment text").fill("");
  b = await layer(page); await tool(page, "Stamp"); await page.getByRole("combobox", { name: "Stamp" }).selectOption("APPROVED"); await page.mouse.click(b.x + 300, b.y + 460); await expect(count(page)).toHaveText("(9)");

  // thread on the sticky note
  const note = page.getByTestId("thread").filter({ hasText: "Check this paragraph" });
  await expect(note.getByTestId("author")).toHaveText("Ada Lovelace");
  await expect(note.locator("time").first()).toHaveAttribute("datetime", /^\d{4}-\d{2}-\d{2}T/);
  await page.getByLabel("Author name").fill("Grace Hopper");
  await note.getByRole("textbox", { name: /^Reply to Note/ }).fill("Agreed, fixing it");
  await note.getByRole("button", { name: "Reply", exact: true }).click();
  await expect(note.getByTestId("reply")).toContainText("Grace Hopper");
  await note.getByRole("button", { name: "Resolve" }).click();
  await expect(note.getByTestId("resolved-badge")).toBeVisible();
  await note.getByRole("button", { name: "Reopen" }).click();
  await expect(note.getByTestId("resolved-badge")).toHaveCount(0);
  await note.getByRole("button", { name: "Resolve" }).click();
  await expect(note.getByTestId("resolved-badge")).toBeVisible();

  // eraser on the rectangle
  b = await layer(page); await tool(page, /^Eraser/); await page.mouse.click(b.x + 590, b.y + 112); await expect(count(page)).toHaveText("(8)");
  await expect(page.getByTestId("thread").filter({ hasText: /^Rectangle/ })).toHaveCount(0);

  await page.getByRole("button", { name: "Save", exact: true }).click();
  const [dl] = await Promise.all([page.waitForEvent("download"), page.getByTestId("download-annotated").click()]);
  const file = info.outputPath("annotated.pdf");
  writeFileSync(file, readFileSync((await dl.path())!));

  // Independent check 1: PDF.js (node)
  const pdf = await getDocument({ data: new Uint8Array(readFileSync(file)), isEvalSupported: false }).promise;
  const anns = (await (await pdf.getPage(1)).getAnnotations()) as any[];
  const types = anns.map((a) => a.subtype).sort();
  for (const t of ["Highlight", "Ink", "Circle", "Line", "Text", "FreeText", "Stamp"]) expect(types).toContain(t);
  expect(types).not.toContain("Square");
  expect(anns.filter((a) => a.subtype === "FreeText")).toHaveLength(2);
  const root = anns.find((a) => a.contentsObj?.str === "Check this paragraph");
  expect(root.titleObj.str).toBe("Ada Lovelace");
  expect(anns.find((a) => a.inReplyTo === root.id && a.replyType === "R").titleObj.str).toBe("Grace Hopper");

  // Independent check 2: qpdf (pikepdf) + pypdf, when the verifier venv exists
  let third: any = null;
  const { existsSync } = await import("node:fs");
  if (existsSync(PY)) third = JSON.parse(execFileSync(PY, [VERIFY, file]).toString()); // fails the test if the verifier errors
  else test.info().annotations.push({ type: "warning", description: "third-party verifier venv missing (python -m venv .venv && pip install pikepdf pypdf)" });
  if (third) {
    expect(third.qpdf_check_problems).toEqual([]);
    const subs = third.qpdf_annots.map((a: any) => a.subtype);
    expect(subs.filter((s: string) => s === "/Text").length).toBe(1 + 1 + 3); // note + reply + 3 review states
    expect(third.qpdf_annots.filter((a: any) => !a.irt).every((a: any) => a.has_ap && a.author && a.nm && a.m.startsWith("D:"))).toBe(true);
    expect(third.qpdf_annots.filter((a: any) => a.state).map((a: any) => a.state)).toEqual(["Completed", "None", "Completed"]);
    expect(third.pypdf_annots.length).toBe(third.qpdf_annots.length);
    console.log(`THIRD-PARTY qpdf ${third.qpdf_version} pypdf ${third.pypdf_version} annots=${third.qpdf_annots.length} problems=${third.qpdf_check_problems.length}`);
    test.info().annotations.push({ type: "third-party", description: `qpdf ${third.qpdf_version}, pypdf ${third.pypdf_version}: ${third.qpdf_annots.length} annots, 0 problems` });
  }

  // survives reopen in the app
  await page.getByTestId("file-input").setInputFiles(file);
  await expect(page.getByTestId("doc-title")).toHaveText("annotated.pdf");
  await expect(count(page)).toHaveText("(8)");
  const reopened = page.getByTestId("thread").filter({ hasText: "Check this paragraph" });
  await expect(reopened.getByTestId("resolved-badge")).toBeVisible();
  await expect(reopened.getByTestId("reply")).toContainText("Agreed, fixing it");
});

test("signature images persist in IndexedDB across reloads", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("file-input").setInputFiles(LOCAL_FIXTURE);
  await page.getByRole("button", { name: "Create signature" }).click();
  await page.getByRole("tab", { name: "Type" }).click();
  await page.getByLabel("Type your name").fill("Ada L");
  await page.getByRole("button", { name: "Use signature" }).click();
  await expect(page.getByTestId("saved-sigs").locator("li")).toHaveCount(1);
  await page.reload();
  await page.getByTestId("file-input").setInputFiles(LOCAL_FIXTURE);
  await expect(page.getByTestId("saved-sigs").locator("li")).toHaveCount(1);
  await page.getByRole("button", { name: "Use saved signature 1" }).click();
  await expect(page.getByRole("button", { name: /^Place on page/ })).toBeEnabled();
  await page.getByRole("button", { name: "Delete saved signature 1" }).click();
  await expect(page.getByTestId("saved-sigs")).toHaveCount(0);
});

test.describe("live backend", () => {
  test.beforeEach(async ({ request }) => { test.skip(!(await apiUp(request)), "backend not running"); });

  test("server annotations: each change is a versioned server write; reply, resolve/reopen, erase", async ({ page, request }) => {
    await signInAndUpload(page);
    await page.getByRole("button", { name: "Annotate" }).click();
    await expect(page.getByTestId("annot-server-mode")).toBeVisible();
    await page.getByLabel("Comment text").fill("Server note");
    await tool(page, "Sticky note"); let b = await layer(page);
    await page.mouse.click(b.x + 300, b.y + 150);
    await expect(page.getByTestId("version-id")).toHaveText(/^v2 /);
    await expect(count(page)).toHaveText("(1)");
    await expect(page.getByText("Unsaved annotations")).toHaveCount(0);
    await page.getByLabel("Comment text").fill("Box");
    await tool(page, "Rectangle"); b = await layer(page);
    await drag(page, b.x + 60, b.y + 250, b.x + 160, b.y + 320);
    await expect(page.getByTestId("version-id")).toHaveText(/^v3 /);
    await expect(count(page)).toHaveText("(2)");
    const note = page.getByTestId("thread").filter({ hasText: "Server note" });
    await expect(note.getByTestId("author")).toHaveText("dev@thynkpdf.dev");
    await note.getByRole("textbox", { name: /^Reply to Note/ }).fill("Server reply");
    await note.getByRole("button", { name: "Reply", exact: true }).click();
    await expect(page.getByTestId("version-id")).toHaveText(/^v4 /);
    await expect(note.getByTestId("reply")).toContainText("Server reply");
    await note.getByRole("button", { name: "Resolve" }).click();
    await expect(page.getByTestId("version-id")).toHaveText(/^v5 /);
    await expect(note.getByTestId("resolved-badge")).toBeVisible();
    await note.getByRole("button", { name: "Reopen" }).click();
    await expect(page.getByTestId("version-id")).toHaveText(/^v6 /);
    await expect(note.getByTestId("resolved-badge")).toHaveCount(0);
    // the server really has them (independent read)
    const tok = await (await request.post(`${process.env.THYNKPDF_API_URL ?? "http://localhost:8000"}/auth/login`, { data: { email: "dev@thynkpdf.dev", password: "ThynkDev-2026!" } })).json();
    const docId = await page.evaluate(() => JSON.parse(sessionStorage.getItem("tp-session-v2")!).lastDocumentId as string);
    const list = await (await request.get(`${process.env.THYNKPDF_API_URL ?? "http://localhost:8000"}/pdf/${docId}/annotations`, { headers: { Authorization: `Bearer ${tok.access_token}` } })).json();
    expect(list.version).toBe(6);
    expect(list.annotations.map((x: { type: string }) => x.type).sort()).toEqual(["square", "text", "text"]);
    // erase the rectangle
    await tool(page, /^Eraser/); b = await layer(page);
    await page.mouse.click(b.x + 61, b.y + 285);
    await expect(page.getByTestId("version-id")).toHaveText(/^v7 /);
    await expect(count(page)).toHaveText("(1)");
  });

  test("server: Unicode comment is written in the browser with Noto Sans and saved as a version", async ({ page }) => {
    await signInAndUpload(page);
    await page.getByRole("button", { name: "Annotate" }).click();
    await page.getByLabel("Comment text").fill("Привет — Ελλάδα");
    await tool(page, "Text comment"); const b = await layer(page);
    await page.mouse.click(b.x + 60, b.y + 400);
    await expect(page.getByTestId("version-id")).toHaveText(/^v2 /);
    await expect(page.getByTestId("thread").getByTestId("contents")).toHaveText("Привет — Ελλάδα");
    await expect(page.getByTestId("error")).toHaveCount(0);
  });

  test("signature on a rotated page", async ({ page }) => {
    await signInAndUpload(page);
    await page.getByRole("button", { name: "Rotate page clockwise" }).click();
    await expect(page.getByTestId("version-id")).toHaveText(/^v2 /);
    await page.getByRole("button", { name: "Create signature" }).click();
    await page.getByRole("tab", { name: "Type" }).click();
    await page.getByLabel("Type your name").fill("Rotated Signer");
    await page.getByRole("button", { name: "Use signature" }).click();
    await page.getByRole("button", { name: /^Place on page/ }).click();
    await page.getByRole("button", { name: "Apply signature" }).click();
    await expect(page.getByTestId("version-id")).toHaveText(/^v3 /);
    await expect(page.getByTestId("error")).toHaveCount(0);
  });

  test("signed-in dashboard has no axe violations", async ({ page }) => {
    await signIn(page);
    await page.goto("/documents");
    await expect(page.getByTestId("doc-table")).toBeVisible();
    await page.getByRole("button", { name: "Versions" }).first().click();
    await expect(page.getByTestId("versions")).toBeVisible();
    const r = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
    expect(r.violations.map((v) => `${v.id}: ${v.nodes.slice(0, 3).map((n) => n.target.join(" ")).join(" | ")}`)).toEqual([]);
  });
});
