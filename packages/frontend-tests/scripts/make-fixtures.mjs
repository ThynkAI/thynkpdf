// Generates deterministic PDF fixtures with pdf-lib (MIT). Run: pnpm --filter @thynkpdf/frontend-tests fixtures
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const out = join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures");
mkdirSync(out, { recursive: true });
const doc = await PDFDocument.create();
doc.setTitle("THYNKPDF sample"); doc.setCreationDate(new Date(0)); doc.setModificationDate(new Date(0));
const font = await doc.embedFont(StandardFonts.Helvetica);
for (let i = 1; i <= 12; i++) {
  const landscape = i === 3;
  const page = doc.addPage(landscape ? [792, 612] : [612, 792]);
  page.drawText(`Page ${i} heading`, { x: 72, y: page.getHeight() - 96, size: 28, font, color: rgb(0.1, 0.1, 0.3) });
  page.drawText("The quick brown fox jumps over the lazy dog.", { x: 72, y: page.getHeight() - 150, size: 14, font });
  if (i % 4 === 2) page.drawText("needle marker here", { x: 72, y: page.getHeight() - 200, size: 14, font });
}
writeFileSync(join(out, "sample-12p.pdf"), await doc.save({ useObjectStreams: false }));
console.log("wrote", join(out, "sample-12p.pdf"));

{
  const f = await PDFDocument.create();
  f.setCreationDate(new Date(0)); f.setModificationDate(new Date(0));
  const font = await f.embedFont(StandardFonts.Helvetica);
  const page = f.addPage([612, 792]);
  page.drawText("Application form", { x: 72, y: 720, size: 22, font });
  const form = f.getForm();
  page.drawText("Full name", { x: 72, y: 664, size: 12, font });
  form.createTextField("full_name").addToPage(page, { x: 160, y: 656, width: 260, height: 22 });
  page.drawText("I agree", { x: 72, y: 624, size: 12, font });
  form.createCheckBox("agree").addToPage(page, { x: 160, y: 620, width: 16, height: 16 });
  page.drawText("Country", { x: 72, y: 584, size: 12, font });
  const dd = form.createDropdown("country"); dd.addOptions(["Canada", "USA", "Other"]); dd.addToPage(page, { x: 160, y: 576, width: 160, height: 22 });
  writeFileSync(join(out, "form-fields.pdf"), await f.save({ useObjectStreams: false }));
  console.log("wrote", join(out, "form-fields.pdf"));
}
