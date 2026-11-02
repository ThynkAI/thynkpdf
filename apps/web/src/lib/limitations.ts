import type { Limitation } from "@thynkpdf/editor-client";

/**
 * Turn backend limitation codes (e.g. SIGNED_DOCUMENT, FONT_NOT_SIMPLE_TYPE1) into plain-language copy.
 * Display only: the backend still decides what is allowed. Pure; unit-tested.
 */
export interface FriendlyNotice { key: string; tone: "info" | "warn"; text: string; details: string[] }

export const SIGNED_TEXT = "This PDF is digitally signed. Editing would break the signature, so editing is turned off.";
export const FONTS_TEXT = "Some text uses fonts that can't be edited safely.";

const DOC: Record<string, string> = {
  SIGNED_DOCUMENT: SIGNED_TEXT,
  PDFA: "This is an archival (PDF/A) file. Saving changes may remove its PDF/A compliance.",
  NO_TEXT_LAYER: "This page has no editable text (it may be a scan or an image).",
  TEXT_MATRIX_TRANSFORMED: "Some text is rotated or scaled and can't be moved.",
};

const isFont = (code: string) => code.startsWith("FONT_");

/** One friendly sentence for a single limitation; unknown codes fall back to the backend's own message. */
export function friendlyText(l: Pick<Limitation, "code" | "message">): string {
  if (DOC[l.code]) return DOC[l.code];
  if (isFont(l.code)) return FONTS_TEXT;
  return l.message;
}

/** Group limitations into de-duplicated notices; font issues collapse into one notice with technical details. */
export function friendlyNotices(lims: readonly Pick<Limitation, "code" | "message">[] | null | undefined): FriendlyNotice[] {
  const out: FriendlyNotice[] = [];
  const fonts: string[] = [];
  const seen = new Set<string>();
  for (const l of lims ?? []) {
    if (isFont(l.code)) { fonts.push(`${l.code}: ${l.message}`); continue; }
    const text = friendlyText(l);
    if (seen.has(text)) continue;
    seen.add(text);
    out.push({ key: l.code, tone: l.code === "SIGNED_DOCUMENT" ? "info" : "warn", text, details: DOC[l.code] ? [`${l.code}: ${l.message}`] : [] });
  }
  if (fonts.length) out.push({ key: "FONTS", tone: "warn", text: FONTS_TEXT, details: [...new Set(fonts)] });
  return out;
}

/** Joined friendly reason for a gate (deduplicated). */
export function friendlyReason(lims: readonly Pick<Limitation, "code" | "message">[] | null | undefined): string {
  return friendlyNotices(lims).map((n) => n.text).join(" ");
}

export const isSigned = (lims: readonly Pick<Limitation, "code">[] | null | undefined) => !!lims?.some((l) => l.code === "SIGNED_DOCUMENT");
