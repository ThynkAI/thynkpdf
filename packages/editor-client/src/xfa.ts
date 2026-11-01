/**
 * XFA types: generated from the backend OpenAPI (feat/xfa, PR #24 commit 363976fe) via `pnpm --filter @thynkpdf/editor-client gen`.
 * Helpers here group the flat schema into sections, handle repeatable subforms and indexed SOM paths.
 */
import type { components } from "./generated/schema";
type S = components["schemas"];
export type XfaInfo = S["XfaInfo"];
export type XfaKind = XfaInfo["kind"];
export type XfaSchemaField = S["XfaSchemaField"];
export type XfaFieldType = XfaSchemaField["type"];
export type XfaLayout = S["XfaLayout"];
export type XfaOccur = S["XfaOccur"];
export type XfaSchemaOut = S["XfaSchemaOut"];
export type XfaDataOut = S["XfaDataOut"];
export type XfaDataField = S["XfaDataField"];
export type XfaCapabilities = S["XfaCapabilities"];
export type XfaFillIn = S["XfaFillIn"];
export type XfaFillReport = S["XfaFillReport"];
export type XfaFillResult = S["XfaFillResult"];
export type XfaImportIn = S["XfaImportIn"];
export type XfaImportMode = NonNullable<XfaImportIn["mode"]>;
export type XfaImportReport = S["XfaImportReport"];
export type XfaImportResult = S["XfaImportResult"];
export type XfaConvertReport = S["XfaConvertReport"];
export type XfaConvertResult = S["XfaConvertResult"];

/** Split a SOM / data path on unescaped dots: `form1[0].Section9\.1[0].X[0]` → ["form1[0]", "Section9\.1[0]", "X[0]"]. */
export function splitSom(p: string): string[] {
  const out: string[] = []; let cur = "";
  for (let i = 0; i < p.length; i++) {
    const c = p[i];
    if (c === "\\" && i + 1 < p.length) { cur += c + p[++i]; continue; }
    if (c === ".") { if (cur) out.push(cur); cur = ""; continue; }
    cur += c;
  }
  if (cur) out.push(cur);
  return out;
}
/** Segment name without index or escapes: `Section9\.1[0]` → `Section9.1`, `#subform[2]` → `#subform`. */
export const somSegmentName = (s: string) => s.replace(/\[\d+\]$/, "").replace(/\\(.)/g, "$1");
/** Index of a segment (`row[2]` → 2, unindexed → 0). */
export const somSegmentIndex = (s: string) => Number(/\[(\d+)\]$/.exec(s)?.[1] ?? 0);
/** Strip every index: `form1[0].body[0].X[0]` → `form1.body.X` (escaped dots kept escaped). */
export const stripSomIndices = (p: string) => p.replace(/\[\d+\]/g, "");
/** Human leaf name of a field: last data-path segment, else last named SOM segment. */
export function xfaLeafName(f: Pick<XfaSchemaField, "name" | "som">): string {
  const segs = splitSom(f.name ?? f.som).map(somSegmentName).filter((s) => !s.startsWith("#"));
  return segs[segs.length - 1] ?? f.som;
}

export interface XfaGroup {
  /** Section SOM (enclosing subform) or "" for the root. */
  path: string;
  name: string;
  caption: string | null;
  fields: XfaSchemaField[];
  groups: XfaGroup[];
  /** Repeatable subform rules and this group's instance (0-based), when the section is a repeat instance. */
  occur?: XfaOccur | null;
  instance?: number | null;
}
const parentSom = (som: string) => splitSom(som).slice(0, -1).join(".");

/**
 * Group the flat schema into sections using the backend's `section` (SOM of the enclosing subform) and
 * `section_caption`/`section_name`; nested sections nest by SOM prefix. Fields without `section` (older backend)
 * fall back to their SOM parent. The single common root subform (form1[0]) is not wrapped in a box.
 */
export function groupXfaFields(fields: XfaSchemaField[]): XfaGroup {
  const root: XfaGroup = { path: "", name: "", caption: null, fields: [], groups: [] };
  const secOf = (f: XfaSchemaField) => f.section ?? parentSom(f.som);
  const secs = fields.map(secOf);
  const first = secs.length ? splitSom(secs[0])[0] : undefined;
  const rootSeg = first && secs.every((s) => s && splitSom(s)[0] === first) ? first : null;
  const byPath = new Map<string, XfaGroup>([["", root]]);
  const meta = new Map<string, XfaSchemaField>();
  fields.forEach((f, i) => { if (!meta.has(secs[i])) meta.set(secs[i], f); });
  const ensure = (path: string): XfaGroup => {
    if (!path || path === rootSeg) return root;
    const hit = byPath.get(path); if (hit) return hit;
    const segs = splitSom(path);
    const parent = ensure(segs.slice(0, -1).join("."));
    const m = meta.get(path);
    const seg = segs[segs.length - 1];
    const raw = somSegmentName(seg);
    const direct = m && (m.section ?? parentSom(m.som)) === path;
    const g: XfaGroup = {
      path, name: (direct ? m?.section_name : null) ?? (raw.startsWith("#") ? "" : raw), caption: (direct ? m?.section_caption : null) ?? null,
      fields: [], groups: [], occur: direct ? m?.occur ?? null : null, instance: direct && m?.occur ? (m.instance ?? somSegmentIndex(seg)) : null,
    };
    byPath.set(path, g); parent.groups.push(g);
    return g;
  };
  fields.forEach((f, i) => ensure(secs[i]).fields.push(f));
  return root;
}
export const xfaGroupTitle = (g: XfaGroup) => (g.caption || g.name || "Section").replace(/[_-]+/g, " ");

/** Re-index the last segment named `seg` in a path: (`app.row[1].item`, "row", 2) → `app.row[2].item`. */
export function xfaInstancePath(path: string, seg: string, to: number): string {
  const segs = splitSom(path);
  let idx = -1;
  segs.forEach((s, i) => { if (somSegmentName(s) === seg) idx = i; });
  if (idx < 0) return path;
  segs[idx] = `${segs[idx].replace(/\[\d+\]$/, "")}[${to}]`;
  return segs.join(".");
}
/** Clone a repeat-instance group as instance `to` (fill keys, SOMs and sections re-indexed; values cleared). */
export function xfaCloneInstance(g: XfaGroup, to: number): XfaGroup {
  const seg = somSegmentName(splitSom(g.path).pop() ?? "");
  const re = (p: string) => xfaInstancePath(p, seg, to);
  const cl = (x: XfaGroup, top: boolean): XfaGroup => ({
    ...x, path: re(x.path), instance: top ? to : x.instance,
    fields: x.fields.map((f) => ({ ...f, name: f.name ? re(f.name) : null, som: re(f.som), section: f.section ? re(f.section) : f.section, instance: top ? to : f.instance, value: null, acroform_field: null })),
    groups: x.groups.map((c) => cl(c, false)),
  });
  return cl(g, true);
}

export const XFA_ERROR_MESSAGES: Record<string, string> = {
  XFA_NOT_PRESENT: "This document has no XFA form data.",
  XFA_MALFORMED: "The XFA form data in this file is malformed, so the server can't read or change it. You can still view it here if the XFA layer rendered.",
  XFA_UNSAFE_XML: "The XFA data contains a DTD or entity declarations, which the server refuses to process for safety. Server-side XFA features are disabled for this file.",
  XFA_TOO_LARGE: "The XFA form is too large for the server to process (limits: 5 MB per packet, 20 MB total, 20k nodes).",
  xfa_dynamic_unsupported: "The server can't convert this dynamic XFA form: it has no template or no convertible fields. You can still fill it here and save a copy.",
  VERSION_CONFLICT: "The document changed since you opened it. The latest version was reloaded — please retry.",
};
