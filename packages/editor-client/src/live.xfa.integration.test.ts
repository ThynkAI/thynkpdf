// @vitest-environment node
/**
 * Live contract test for the XFA endpoints (backend PR #24 @ 363976fe). Skipped when the API is down or doesn't report
 * /capabilities `xfa` yet (older backend, e.g. main before #24 merges).
 */
import { readFileSync } from "node:fs";
import { HttpEditorApi } from "./http";
import { ApiError } from "./http";
import { groupXfaFields, splitSom, type XfaCapabilities, type XfaSchemaField } from "./xfa";
import type { DocumentRef } from "./types";

const BASE = process.env.THYNKPDF_API_URL ?? "http://localhost:8000";
const fx = (n: string) => readFileSync(new URL(`../../frontend-tests/fixtures/${n}`, import.meta.url));
async function fresh(file: string) {
  const api = new HttpEditorApi({ baseUrl: BASE });
  api.setTokens(await api.localSession("live-test-browser-key-0123456789abcdef"));  // no accounts: anonymous workspace
  const u = await api.upload(new Blob([fx(file)], { type: "application/pdf" }), file);
  return { api, ref: { document_id: u.document_id, version_id: u.version_id, version: u.version } as DocumentRef };
}
const supported = await (async () => {
  try {
    if (!(await fetch(BASE + "/health")).ok) return false;
    const { api, ref } = await fresh("xfa-hybrid.pdf");
    return !!(await api.getCapabilities(ref.document_id) as { xfa?: unknown }).xfa;
  } catch { return false; }
})();
const r = (v: { document_id: string; version_id: string; version: number }): DocumentRef => ({ document_id: v.document_id, version_id: v.version_id, version: v.version });

describe.skipIf(!supported)("live API XFA (contract 363976fe)", () => {
  it("/capabilities xfa gates features; plain PDFs report present=false", async () => {
    const { api, ref } = await fresh("xfa-hybrid.pdf");
    const x = (await api.getCapabilities(ref.document_id) as { xfa: XfaCapabilities }).xfa;
    expect(x).toMatchObject({ present: true, kind: "hybrid", read: true, schema: true, fill: true, xml_import_export: true, convert: true });
    const p = await fresh("form-fields.pdf");
    expect((await p.api.getCapabilities(p.ref.document_id) as { xfa: XfaCapabilities | null }).xfa?.present ?? false).toBe(false);
  });
  it("schema: indexed som (== acroform_field on hybrid), section fields, groupable", async () => {
    const { api, ref } = await fresh("xfa-hybrid.pdf");
    const s = await api.getXfaSchema(ref.document_id, ref.version);
    expect(s.fields.length).toBeGreaterThan(0);
    for (const f of s.fields as XfaSchemaField[]) {
      expect(splitSom(f.som).every((seg) => /\[\d+\]$/.test(seg))).toBe(true);
      if (f.acroform_field) expect(f.som).toBe(f.acroform_field);
      expect("section" in f || f.section === undefined).toBe(true);
    }
    const g = groupXfaFields(s.fields);
    const count = (x: ReturnType<typeof groupXfaFields>): number => x.fields.length + x.groups.reduce((n, c) => n + count(c), 0);
    expect(count(g)).toBe(s.fields.length);
  });
  it("fill by data path, then import XML: merge keeps other values, replace clears them", async () => {
    const { api, ref } = await fresh("xfa-hybrid.pdf");
    const s = await api.getXfaSchema(ref.document_id, ref.version);
    const texts = s.fields.filter((f) => f.name && f.type === "text" && !f.read_only);
    expect(texts.length).toBeGreaterThanOrEqual(2);
    const [a, b] = texts;
    let v = await api.fillXfa(ref, { [a.name!]: "Alpha", [b.name!]: "Bravo" });
    expect(v.report.filled.length).toBeGreaterThanOrEqual(2);
    const val = async (ver: number, n: string) => (await api.getXfaData(ref.document_id, ver)).fields.find((x) => x.name === n)?.value;
    expect(await val(v.version, b.name!)).toBe("Bravo");
    // Bare record containing only field a (leaf names from the data path).
    const segs = splitSom(a.name!).map((x) => x.replace(/\[\d+\]$/, ""));
    const xml = segs.reduceRight((inner, tag) => `<${tag}>${inner}</${tag}>`, "Merged");
    const m = await api.importXfaData(r(v), xml);
    expect(m.report.mode).toBe("merge");
    expect(await val(m.version, a.name!)).toBe("Merged");
    expect(await val(m.version, b.name!)).toBe("Bravo");
    const rep = await api.importXfaData(r(m), xml.replace("Merged", "Replaced"), "replace");
    expect(rep.report.mode).toBe("replace");
    expect(await val(rep.version, a.name!)).toBe("Replaced");
    expect(await val(rep.version, b.name!) ?? "").toBe("");
  });
  it("stale expected_version is 409 VERSION_CONFLICT before XFA checks", async () => {
    const { api, ref } = await fresh("xfa-hybrid.pdf");
    const c = await api.convertXfaToAcroForm(ref);
    expect(c.report.mode).toBe("stripped_xfa");
    const e = await api.fillXfa(ref, { x: "1" }).catch((x) => x);
    expect(e).toBeInstanceOf(ApiError);
    expect((e as ApiError).status).toBe(409);
  });
  it("dynamic form: schema + capabilities", async () => {
    const { api, ref } = await fresh("xfa-dynamic.pdf");
    const x = (await api.getCapabilities(ref.document_id) as { xfa: XfaCapabilities }).xfa;
    expect(x.kind).toBe("dynamic");
    const s = await api.getXfaSchema(ref.document_id, ref.version);
    expect(s.xfa.kind).toBe("dynamic");
    expect(s.fields.some((f) => f.section)).toBe(true);
  });
});
