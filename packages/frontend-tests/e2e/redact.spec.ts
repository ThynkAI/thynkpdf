import { test, expect, type Page } from "@playwright/test";
import { deflateSync } from "node:zlib";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import os from "node:os";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { API, apiUp, openWorkspace, workspaceToken, stableBox, LOCAL_FIXTURE } from "./helpers";

const here = path.dirname(new URL(import.meta.url).pathname);
const PY = path.join(here, "..", ".venv", "bin", "python");
const SHOTS = process.env.REDACT_SHOTS; // optional: save review screenshots here
const shot = async (page: Page, name: string, loc?: import("@playwright/test").Locator) => {
  if (!SHOTS) return; mkdirSync(SHOTS, { recursive: true });
  await (loc ?? page).screenshot({ path: path.join(SHOTS, `${name}.png`) });
};

const crcT = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc = (b: Uint8Array) => { let c = 0xffffffff; for (const x of b) c = crcT[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
/** w×h RGB PNG: blue gradient with a white centre square, so redacted pixels are easy to tell apart. */
function png(w: number, h: number): Buffer {
  const chunk = (type: string, data: Buffer) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  const raw = Buffer.alloc(h * (1 + w * 3));
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const centre = Math.abs(x - w / 2) < w / 4 && Math.abs(y - h / 2) < h / 4;
    raw.set(centre ? [255, 255, 255] : [40, Math.round((y / h) * 200), 220], y * (1 + w * 3) + 1 + x * 3);
  }
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}
const SECRET = "SECRET-ACCOUNT-778899", EMAIL = "jane.doe@example.com";
async function sensitivePdf(file: string) {
  const d = await PDFDocument.create(); const f = await d.embedFont(StandardFonts.Helvetica); const p = d.addPage([612, 792]);
  p.drawText("Public intro line.", { x: 72, y: 720, size: 14, font: f });
  p.drawText(`Account: ${SECRET} (keep this label)`, { x: 72, y: 690, size: 12, font: f });
  p.drawText(`Contact ${EMAIL} today`, { x: 72, y: 660, size: 12, font: f });
  p.drawImage(await d.embedPng(png(200, 200)), { x: 300, y: 300, width: 200, height: 200 });
  p.drawText("Footer stays.", { x: 72, y: 100, size: 12, font: f, color: rgb(0, 0, 0) });
  d.setTitle("Confidential memo"); d.setAuthor("Jane Doe");
  writeFileSync(file, await d.save());
}
async function pdfText(bytes: Uint8Array) {
  const pdf = await getDocument({ data: bytes.slice(), isEvalSupported: false }).promise; let out = ""; // copy: PDF.js detaches the buffer
  for (let i = 1; i <= pdf.numPages; i++) out += (await (await pdf.getPage(i)).getTextContent()).items.map((x) => ("str" in x ? x.str : "")).join(" ") + "\n";
  return out;
}
/** Screen point of a PDF user-space point on page 1 (unrotated page). */
async function screenPt(page: Page, x: number, y: number) {
  const b = await stableBox(page.getByTestId("redact-layer-1"));
  return { x: b.x + (x / 612) * b.width, y: b.y + ((792 - y) / 792) * b.height };
}

test("redact: find + pattern + area over an image, review list (Delete / Ctrl+Z), apply → new file with content removed", async ({ page, request }) => {
  test.skip(!(await apiUp(request)), "backend not running");
  test.setTimeout(120_000);
  const file = path.join(os.tmpdir(), `redact-e2e-${Date.now()}.pdf`); await sensitivePdf(file);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await openWorkspace(page);
  await page.getByTestId("file-input").setInputFiles(file);
  await expect(page.getByTestId("version-id")).toHaveText(/^v1 /);
  await page.getByRole("button", { name: "Tool: Redact" }).click();
  await expect(page.getByTestId("redact-panel")).toBeVisible();
  // search-and-redact: literal text + the e-mail pattern
  await page.getByLabel("Text or pattern to redact").fill(SECRET);
  await page.getByTestId("redact-panel").getByLabel(/E-?mail/i).check();
  await page.getByTestId("redact-search").click();
  await expect(page.getByTestId("redact-results")).toContainText("2 matches");
  await page.getByTestId("redact-mark-results").click();
  await expect(page.getByTestId("redact-count")).toHaveText("(2)");
  // area: drag over the centre of the image (PDF 350,350 → 450,450)
  await expect(page.getByTestId("redact-tool-area").first()).toHaveAttribute("aria-pressed", "true"); // area is the default mark tool
  const a = await screenPt(page, 350, 450), b = await screenPt(page, 450, 350);
  await page.mouse.move(a.x, a.y); await page.mouse.down(); await page.mouse.move(b.x, b.y, { steps: 6 }); await page.mouse.up();
  await expect(page.getByTestId("redact-count")).toHaveText("(3)");
  await expect(page.locator(".tp-redact-mark")).toHaveCount(3);
  await shot(page, "02-redact-marks");
  // review list: select → Delete → Ctrl+Z
  await page.getByTestId("redact-marks").getByRole("button", { name: /search/ }).first().click();
  await page.keyboard.press("Delete");
  await expect(page.getByTestId("redact-count")).toHaveText("(2)");
  await page.keyboard.press("Control+z");
  await expect(page.getByTestId("redact-count")).toHaveText("(3)");
  // apply: irreversible warning, acknowledgement required, new file by default
  await page.getByTestId("redact-apply").click();
  const dlg = page.getByTestId("redact-dialog");
  await expect(dlg.getByRole("alert")).toContainText(/permanently/i);
  await expect(page.getByTestId("redact-confirm")).toBeDisabled();
  await expect(page.getByTestId("redact-hidden")).toBeChecked(); // metadata/scripts/attachments removed by default
  await page.getByTestId("redact-ack").check();
  await shot(page, "03-redact-apply-dialog", dlg);
  await page.getByTestId("redact-confirm").click();
  await expect(page.getByText(/Redaction applied/)).toBeVisible({ timeout: 30_000 });
  await expect(page.locator(".tp-redact-mark")).toHaveCount(0);
  await shot(page, "04-redacted-result");
  // independent check of the stored files through the API
  const token = await workspaceToken(page, request); const h = { authorization: `Bearer ${token}` };
  const docs = (await (await request.get(API + "/documents", { headers: h })).json()) as { items?: { id?: string; document_id?: string; filename?: string; name?: string }[] } | { id?: string; document_id?: string; filename?: string; name?: string }[];
  const list = Array.isArray(docs) ? docs : docs.items ?? [];
  const red = list.find((d) => /-redacted\.pdf$/.test(d.filename ?? d.name ?? ""))!; expect(red).toBeTruthy();
  const orig = list.find((d) => (d.filename ?? d.name) === path.basename(file))!;
  const get = async (d: typeof red) => new Uint8Array(await (await request.get(`${API}/documents/${d.document_id ?? d.id}/download`, { headers: h })).body());
  const redBytes = await get(red), origBytes = await get(orig);
  const t = await pdfText(redBytes);
  expect(t).not.toContain("778899"); expect(t).not.toContain("jane.doe"); expect(t).toContain("Public intro line."); expect(t).toContain("Footer stays.");
  expect(await pdfText(origBytes)).toContain(SECRET); // the original is untouched
  const out = path.join(os.tmpdir(), `redacted-${Date.now()}.pdf`); writeFileSync(out, redBytes);
  if (existsSync(PY)) {
    // embedded image pixels under the mark are replaced (not just covered); outside the mark unchanged; metadata gone
    const r = JSON.parse(execFileSync(PY, ["-c", `
import json,sys,pikepdf
from pikepdf import PdfImage
p=pikepdf.open(sys.argv[1]); im=[PdfImage(v).as_pil_image().convert("RGB") for v in p.pages[0].images.values()][0]
print(json.dumps({"centre":im.getpixel((100,100)),"corner":im.getpixel((5,5)),"docinfo":[str(k) for k in p.docinfo.keys()],"raw_secret":any(b"778899" in o.read_bytes() for o in p.objects if isinstance(o,pikepdf.Stream))}))`, out]).toString());
    expect(r.centre).toEqual([0, 0, 0]); expect(r.corner).not.toEqual([0, 0, 0]); expect(r.raw_secret).toBe(false); expect(r.docinfo).toEqual([]);
  } else test.info().annotations.push({ type: "warning", description: "pikepdf venv missing; image-pixel check skipped" });
});

test("images: place, move, resize, rotate, delete + undo, save into the PDF (local, no sign-in)", async ({ page }) => {
  await page.route(API + "/**", (r) => r.abort()); // offline: everything happens in the browser
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/");
  await page.getByTestId("file-input").setInputFiles(LOCAL_FIXTURE);
  await expect(page.getByTestId("status-page")).toHaveText("Page 1 of 12");
  await page.getByRole("button", { name: "Tool: Add image" }).click();
  await page.getByTestId("image-input").setInputFiles({ name: "logo.png", mimeType: "image/png", buffer: png(120, 80) });
  const box = page.getByTestId("image-box");
  await expect(box).toHaveCount(1);
  const b0 = (await stableBox(box))!;
  // move
  await page.mouse.move(b0.x + b0.width / 2, b0.y + b0.height / 2); await page.mouse.down();
  await page.mouse.move(b0.x + b0.width / 2 + 60, b0.y + b0.height / 2 + 40, { steps: 5 }); await page.mouse.up();
  const b1 = (await box.boundingBox())!; expect(b1.x).toBeGreaterThan(b0.x + 40);
  // resize from the corner handle
  const rh = (await page.getByTestId("image-resize").boundingBox())!;
  await page.mouse.move(rh.x + rh.width / 2, rh.y + rh.height / 2); await page.mouse.down();
  await page.mouse.move(rh.x + 80, rh.y + 60, { steps: 5 }); await page.mouse.up();
  const b2 = (await box.boundingBox())!; expect(b2.width).toBeGreaterThan(b1.width + 30);
  // rotate with the knob
  const k = (await page.getByTestId("image-rotate").boundingBox())!;
  const c = { x: b2.x + b2.width / 2, y: b2.y + b2.height / 2 };
  await page.mouse.move(k.x + k.width / 2, k.y + k.height / 2); await page.mouse.down();
  await page.mouse.move(c.x + 200, c.y, { steps: 8 }); await page.mouse.up();
  await expect(box).toHaveAttribute("style", /rotate\((8\d|9\d)(\.\d+)?deg\)/);
  await shot(page, "05-image-placed");
  // delete + undo
  await box.click(); await page.keyboard.press("Delete");
  await expect(box).toHaveCount(0);
  await page.keyboard.press("Control+z");
  await expect(box).toHaveCount(1);
  await page.getByTestId("image-apply").click();
  await expect(box).toHaveCount(0);
  const [dl] = await Promise.all([page.waitForEvent("download"), page.getByTestId("download-images").click()]);
  const bytes = new Uint8Array(readFileSync((await dl.path())!));
  const pdf = await PDFDocument.load(bytes); expect(pdf.getPageCount()).toBe(12);
  const doc = await getDocument({ data: bytes, isEvalSupported: false }).promise;
  const ops = await (await doc.getPage(1)).getOperatorList();
  const { OPS } = await import("pdfjs-dist/legacy/build/pdf.mjs");
  expect(ops.fnArray.filter((f) => f === OPS.paintImageXObject).length).toBeGreaterThanOrEqual(1);
});

test("images to PDF: pick several images, reorder, create (opens as a PDF); export a page as PNG", async ({ page }) => {
  await page.route(API + "/**", (r) => r.abort());
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/");
  await page.getByTestId("file-input").setInputFiles([
    { name: "a-wide.png", mimeType: "image/png", buffer: png(300, 150) },
    { name: "b-tall.png", mimeType: "image/png", buffer: png(150, 300) },
  ]);
  const dlg = page.getByTestId("images-to-pdf");
  await expect(dlg).toBeVisible();
  const items = page.getByTestId("i2p-list").getByRole("listitem");
  await expect(items).toHaveCount(2);
  await expect(items.first()).toContainText("a-wide.png");
  await items.nth(1).getByRole("button", { name: /Move .* up/ }).click();
  await expect(items.first()).toContainText("b-tall.png");
  await shot(page, "06-images-to-pdf-dialog", dlg);
  await page.getByTestId("i2p-create").click();
  await expect(page.getByTestId("status-page")).toHaveText("Page 1 of 2");
  // first page is the tall image (portrait page)
  await page.getByRole("button", { name: "Tool: Export images" }).click();
  await expect(page.getByTestId("export-panel")).toBeVisible();
  await shot(page, "07-export-panel");
  const [dl] = await Promise.all([page.waitForEvent("download"), page.getByTestId("export-images").click()]);
  expect(dl.suggestedFilename()).toMatch(/\.png$/);
  const img = readFileSync((await dl.path())!);
  expect(img.subarray(1, 4).toString()).toBe("PNG");
  const w = img.readUInt32BE(16), h = img.readUInt32BE(20); expect(h).toBeGreaterThan(w); // portrait = tall image first
});

test("home shows the new tool tiles", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/");
  for (const t of ["redact", "add-image", "image-to-pdf", "export-images"]) await expect(page.getByTestId(`home-tile-${t}`)).toBeVisible();
  await shot(page, "01-home-tiles");
});
