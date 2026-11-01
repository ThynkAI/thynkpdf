/**
 * How a document's XFA (if any) is being shown:
 * - "pure": dynamic XFA rendered by PDF.js's XFA layer (HTML form, fillable; saved via annotationStorage → saveDocument).
 * - "hybrid": XFA + real AcroForm widgets; we render and fill the AcroForm version (what PDF.js supports reliably).
 * - "unrendered": XFA present but PDF.js could not lay it out, so the placeholder page is all we can show.
 */
export type XfaMode = "none" | "pure" | "hybrid" | "unrendered";
export const XFA_PLACEHOLDER_RE = /please wait\.{0,3}|later version of (the )?(adobe|pdf)|not (be able|able) to display this type of document|eventually replaced by the proper contents/i;
export function classifyXfa(o: { isPureXfa: boolean; xfaPresent: boolean; firstPageText: string }): XfaMode {
  if (o.isPureXfa) return "pure";
  if (!o.xfaPresent) return "none";
  return XFA_PLACEHOLDER_RE.test(o.firstPageText) ? "unrendered" : "hybrid";
}
