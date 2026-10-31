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
