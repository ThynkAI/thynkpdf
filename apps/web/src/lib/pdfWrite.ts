/**
 * Client-side PDF writes with pdf-lib (MIT). Used for visual signatures and AcroForm fill/creation because the backend
 * has no endpoints for these yet (see apps/web/docs/frontend-backend-requests.md §3–4). Output is a real PDF.
 */
import { degrees, PDFDocument, PDFTextField, PDFCheckBox, PDFDropdown, PDFRadioGroup, StandardFonts } from "pdf-lib";

export interface PdfRect { x: number; y: number; width: number; height: number } // PDF user space, origin bottom-left

/** Convert a box in CSS px (top-left origin, unrotated page at `scale`) to PDF user space. */
export function cssToPdfRect(box: { left: number; top: number; width: number; height: number }, scale: number, pageHeightPt: number, origin = { x: 0, y: 0 }): PdfRect {
  return { x: origin.x + box.left / scale, y: origin.y + pageHeightPt - (box.top + box.height) / scale, width: box.width / scale, height: box.height / scale };
}

export async function pageInfo(bytes: Uint8Array, pageIndex: number) {
  const pdf = await PDFDocument.load(bytes, { ignoreEncryption: false });
  const p = pdf.getPage(pageIndex); const mb = p.getMediaBox();
  return { rotation: ((p.getRotation().angle % 360) + 360) % 360, width: mb.width, height: mb.height, origin: { x: mb.x, y: mb.y } };
}

/** rect.rotate (degrees CCW, about x/y) lets the image stay upright on rotated pages; see geometry.uprightImagePlacement. */
export async function stampImage(bytes: Uint8Array, pageIndex: number, rect: PdfRect & { rotate?: number }, image: Uint8Array, mime: "image/png" | "image/jpeg"): Promise<Uint8Array> {
  const pdf = await PDFDocument.load(bytes);
  const img = mime === "image/png" ? await pdf.embedPng(image) : await pdf.embedJpg(image);
  const page = pdf.getPage(pageIndex);
  const { rotate, ...r } = rect;
  page.drawImage(img, { ...r, rotate: degrees(rotate ?? 0) });
  return pdf.save();
}

export type FieldType = "text" | "checkbox" | "dropdown" | "radio" | "other";
export interface FieldInfo { name: string; type: FieldType; value: string | boolean; options?: string[]; readOnly: boolean; required?: boolean; hasActions?: boolean }

export async function listFields(bytes: Uint8Array): Promise<FieldInfo[]> {
  const pdf = await PDFDocument.load(bytes);
  return pdf.getForm().getFields().map((f) => {
    const base = { name: f.getName(), readOnly: f.isReadOnly() };
    if (f instanceof PDFTextField) return { ...base, type: "text" as const, value: f.getText() ?? "" };
    if (f instanceof PDFCheckBox) return { ...base, type: "checkbox" as const, value: f.isChecked() };
    if (f instanceof PDFDropdown) return { ...base, type: "dropdown" as const, value: f.getSelected()[0] ?? "", options: f.getOptions() };
    if (f instanceof PDFRadioGroup) return { ...base, type: "radio" as const, value: f.getSelected() ?? "", options: f.getOptions() };
    return { ...base, type: "other" as const, value: "" };
  });
}

export async function fillFields(bytes: Uint8Array, values: Record<string, string | boolean>): Promise<Uint8Array> {
  const pdf = await PDFDocument.load(bytes);
  const form = pdf.getForm();
  for (const [name, v] of Object.entries(values)) {
    const f = form.getField(name);
    if (f instanceof PDFTextField) f.setText(String(v));
    else if (f instanceof PDFCheckBox) { if (v) f.check(); else f.uncheck(); }
    else if (f instanceof PDFDropdown) f.select(String(v));
    else if (f instanceof PDFRadioGroup) f.select(String(v));
  }
  form.updateFieldAppearances(await pdf.embedFont(StandardFonts.Helvetica));
  return pdf.save();
}

export async function addField(bytes: Uint8Array, spec: { name: string; type: "text" | "checkbox"; pageIndex: number; rect: PdfRect }): Promise<Uint8Array> {
  const pdf = await PDFDocument.load(bytes);
  const form = pdf.getForm();
  if (form.getFields().some((f) => f.getName() === spec.name)) throw new Error(`A field named “${spec.name}” already exists.`);
  const page = pdf.getPage(spec.pageIndex);
  const f = spec.type === "text" ? form.createTextField(spec.name) : form.createCheckBox(spec.name);
  f.addToPage(page, { ...spec.rect, borderWidth: 1 });
  return pdf.save();
}
