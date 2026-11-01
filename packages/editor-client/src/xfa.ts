/**
 * XFA types matching backend PR #24 (branch feat/xfa, docs/integration-for-bot1.md "XFA forms").
 * Hand-written until the generated OpenAPI client includes them; all endpoints are feature-detected by callers.
 */
export type XfaKind = "none" | "hybrid" | "dynamic";
export interface XfaInfo {
  present: boolean; kind: XfaKind; form?: "stream" | "array" | null; packets: string[]; has_scripts: boolean;
  script_count?: number; needs_rendering?: boolean; acroform_widgets?: number; xml_safe?: boolean | null;
}
export type XfaFieldType = "text" | "numeric" | "date" | "checkbox" | "choice" | "radio" | "signature" | "button" | "image" | "barcode" | "password";
export interface XfaLayout { x?: number | null; y?: number | null; w?: number | null; h?: number | null; units?: "pt"; origin?: string | null }
export interface XfaSchemaField {
  /** Data path (fill key), e.g. form1.address.city; null when unbound. */
  name: string | null;
  som: string;
  type: XfaFieldType | string;
  caption?: string | null;
  /** choice/radio: saved values; labels in option_captions */
  options?: string[] | null;
  option_captions?: string[] | null;
  multi_select?: boolean | null;
  on_value?: string | null;
  value?: unknown;
  required: boolean; read_only: boolean; multiline: boolean; max_chars?: number | null;
  layout?: XfaLayout | null;
}
export interface XfaSchemaOut { document_id: string; version: number; xfa: XfaInfo; fields: XfaSchemaField[]; warnings: string[]; scripts_ignored: number }
export interface XfaDataOut { document_id: string; version: number; xfa: XfaInfo; fields: { name: string; value: string; acroform_field: string | null }[] }

/** Client-side grouping of the flat schema into subforms (by data path, falling back to SOM). */
export interface XfaGroup { name: string; path: string; fields: XfaSchemaField[]; groups: XfaGroup[] }
const segs = (f: XfaSchemaField) => (f.name ?? f.som.replace(/\[\d+\]/g, "")).split(".").filter(Boolean);
export function groupXfaFields(fields: XfaSchemaField[]): XfaGroup {
  const root: XfaGroup = { name: "", path: "", fields: [], groups: [] };
  const all = fields.map(segs);
  // Drop the common root subform (e.g. form1) so the form isn't wrapped in one pointless box.
  const common = all.length && all.every((s) => s.length > 1 && s[0] === all[0][0]) ? 1 : 0;
  fields.forEach((f, i) => {
    let g = root;
    for (const p of all[i].slice(common, -1)) {
      let c = g.groups.find((x) => x.name === p);
      if (!c) { c = { name: p, path: g.path ? `${g.path}.${p}` : p, fields: [], groups: [] }; g.groups.push(c); }
      g = c;
    }
    g.fields.push(f);
  });
  return root;
}
export const XFA_ERROR_MESSAGES: Record<string, string> = {
  XFA_NOT_PRESENT: "This document has no XFA form data.",
  XFA_MALFORMED: "The XFA form data in this file is malformed, so the server can't read or change it. You can still view it here if the XFA layer rendered.",
  XFA_UNSAFE_XML: "The XFA data contains a DTD or entity declarations, which the server refuses to process for safety. Server-side XFA features are disabled for this file.",
  XFA_TOO_LARGE: "The XFA form is too large for the server to process (limits: 5 MB per packet, 20 MB total, 20k nodes).",
  xfa_dynamic_unsupported: "The server can't convert this dynamic XFA form: it has no template or no convertible fields. You can still fill it here and save a copy.",
  VERSION_CONFLICT: "The document changed since you opened it. The latest version was reloaded — please retry.",
};
