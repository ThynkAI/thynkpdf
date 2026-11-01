/**
 * PROVISIONAL types for the backend dynamic-XFA schema (THYNKPDF2, branch feat/xfa). Recorded in
 * apps/web/docs/frontend-backend-requests.md (R7.6). Update when the backend publishes its OpenAPI.
 */
export type XfaKind = "none" | "hybrid" | "dynamic";
export type XfaFieldType = "text" | "multiline" | "numeric" | "date" | "checkbox" | "radio" | "choice" | "signature" | "button" | "image" | "barcode" | "other";
export interface XfaLayout { x?: number | null; y?: number | null; w?: number | null; h?: number | null; page?: number | null; layout?: "position" | "tb" | "lr-tb" | "rl-tb" | "row" | "table" | null }
export interface XfaField {
  kind: "field";
  name: string;
  /** Full SOM path, e.g. form1[0].body[0].City[0]; the key used for fill/values. */
  som: string;
  type: XfaFieldType;
  caption?: string | null;
  /** Data binding (bind ref / match), e.g. $.body.City */
  binding?: string | null;
  value?: string | boolean | null;
  options?: { value: string; label: string }[] | null;
  required?: boolean;
  read_only?: boolean;
  max_chars?: number | null;
  has_scripts?: boolean;
  layout?: XfaLayout | null;
}
export interface XfaSubform {
  kind: "subform";
  name: string;
  som: string;
  caption?: string | null;
  /** repeatable (occur max > 1) */
  repeatable?: boolean;
  layout?: XfaLayout | null;
  children: XfaNode[];
}
export type XfaNode = XfaField | XfaSubform;
export interface XfaSchema { kind: XfaKind; packets: string[]; has_scripts: boolean; root: XfaSubform }
export function flattenXfaFields(n: XfaNode, out: XfaField[] = []): XfaField[] {
  if (n.kind === "field") out.push(n); else n.children.forEach((c) => flattenXfaFields(c, out));
  return out;
}
