/** Build signature-request fields: one signature field (+ a date field beside it) per signer, stacked upward from a base box. Rects are PDF user space [x0,y0,x1,y1]. */
export interface Box { x: number; y: number; width: number; height: number }
export function buildRequestFields(signerCount: number, page: number, base: Box, withDate: boolean, pageWidth: number) {
  const out: { signer_index: number; page: number; rect: number[]; type: "signature" | "date" }[] = [];
  for (let i = 0; i < signerCount; i++) {
    const y = base.y + i * (base.height + 12);
    out.push({ signer_index: i, page, rect: [base.x, y, base.x + base.width, y + base.height], type: "signature" });
    if (withDate) {
      const x0 = Math.min(base.x + base.width + 12, pageWidth - 110);
      out.push({ signer_index: i, page, rect: [x0, y, x0 + 100, y + Math.min(base.height, 20)], type: "date" });
    }
  }
  return out;
}
export const isEmail = (s: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.trim());
