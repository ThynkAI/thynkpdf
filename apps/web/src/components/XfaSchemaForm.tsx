"use client";
import { useRef, useState } from "react";
import { groupXfaFields, type XfaSchemaOut, type XfaSchemaField, type XfaGroup } from "@thynkpdf/editor-client";

export interface XfaSchemaFormProps {
  schema: Pick<XfaSchemaOut, "fields" | "warnings" | "scripts_ignored"> & { xfa?: { has_scripts?: boolean } };
  busy?: boolean;
  onSubmit(values: Record<string, string | boolean>): void | Promise<void>;
  /** Omit to hide the action (endpoint not available). */
  onImportXml?(xml: string): void | Promise<void>;
  onExportXml?(): void | Promise<void>;
}

const input = "w-full rounded border px-2 py-1 dark:border-neutral-700 dark:bg-neutral-800";
const label = (s: string) => s.replace(/[_-]+/g, " ");
const initial = (f: XfaSchemaField): string | boolean => f.type === "checkbox" ? (f.value === true || (f.on_value != null ? String(f.value) === f.on_value : String(f.value ?? "") === "1")) : f.value == null ? "" : String(f.value);

/** Schema-driven fill form for dynamic XFA (fields from GET /pdf/{id}/forms/xfa/schema). PDF.js rendering stays the primary view. */
export function XfaSchemaForm({ schema, busy, onSubmit, onImportXml, onExportXml }: XfaSchemaFormProps) {
  const [vals, setVals] = useState<Record<string, string | boolean>>({});
  const fileRef = useRef<HTMLInputElement>(null);
  const set = (k: string, v: string | boolean) => setVals((p) => ({ ...p, [k]: v }));
  const tree = groupXfaFields(schema.fields);

  const field = (f: XfaSchemaField) => {
    const text = f.caption || label(f.name?.split(".").pop() ?? f.som);
    const key = f.name; // fill key; unbound fields can't be filled
    const ro = f.read_only || !key;
    const v = key && key in vals ? vals[key] : initial(f);
    const meta = `${f.required ? " *" : ""}${f.read_only ? " (read-only)" : ""}${!key ? " (not bound to data)" : ""}`;
    const opts = (f.options ?? []).map((o, i) => ({ value: o, label: f.option_captions?.[i] ?? o }));
    let control;
    switch (f.type) {
      case "checkbox": control = <input type="checkbox" className="ml-2" aria-label={text} disabled={ro} checked={!!v} onChange={(e) => key && set(key, e.target.checked)} />; break;
      case "radio": case "choice":
        control = <select aria-label={text} className={input} disabled={ro} value={String(v)} onChange={(e) => key && set(key, e.target.value)}><option value="">—</option>{opts.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select>; break;
      case "text": case "numeric": case "date": case "password":
        control = f.multiline
          ? <textarea aria-label={text} className={input} disabled={ro} maxLength={f.max_chars ?? undefined} value={String(v)} onChange={(e) => key && set(key, e.target.value)} />
          : <input aria-label={text} className={input} disabled={ro} type={f.type === "password" ? "password" : "text"} inputMode={f.type === "numeric" ? "decimal" : undefined} placeholder={f.type === "date" ? "date" : undefined} maxLength={f.max_chars ?? undefined} value={String(v)} onChange={(e) => key && set(key, e.target.value)} />; break;
      default: control = <span className="ml-2 text-neutral-500">{f.type} field — not editable here</span>;
    }
    return <label key={f.som} className="block" data-som={f.som}><span className="text-neutral-500">{text}{meta}</span>{control}</label>;
  };
  const group = (g: XfaGroup, depth: number): React.ReactNode => (
    <fieldset key={g.path || "root"} className={depth ? "rounded border border-neutral-200 p-1 dark:border-neutral-700" : ""} data-path={g.path}>
      {depth > 0 && <legend className="px-1 font-medium">{label(g.name)}</legend>}
      <div className="space-y-1">{g.fields.map(field)}{g.groups.map((c) => group(c, depth + 1))}</div>
    </fieldset>);

  return (
    <div data-testid="xfa-schema-form" className="text-xs">
      {(schema.scripts_ignored > 0 || schema.xfa?.has_scripts) && <p className="mb-1 text-amber-700">This form has scripts{schema.scripts_ignored ? ` (${schema.scripts_ignored})` : ""} for calculations/validation; they are not run.</p>}
      {schema.warnings?.length > 0 && <ul className="mb-1 list-disc pl-4 text-neutral-500">{schema.warnings.map((w) => <li key={w}>{w}</li>)}</ul>}
      <form className="space-y-1" onSubmit={(e) => { e.preventDefault(); void onSubmit(vals); }}>
        {group(tree, 0)}
        <button className="rounded bg-brand-600 px-3 py-1 text-white disabled:opacity-40" disabled={!Object.keys(vals).length || busy}>Save values (new version)</button>
      </form>
      {(onImportXml || onExportXml) && (
        <div className="mt-1 flex gap-1">
          {onImportXml && <>
            <button type="button" className="rounded border px-2 py-1 dark:border-neutral-700" disabled={busy} onClick={() => fileRef.current?.click()}>Import data XML</button>
            <input ref={fileRef} type="file" accept=".xml,application/xml,text/xml" hidden data-testid="xfa-xml-input" onChange={async (e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) await onImportXml(await f.text()); }} />
          </>}
          {onExportXml && <button type="button" className="rounded border px-2 py-1 dark:border-neutral-700" disabled={busy} onClick={() => void onExportXml()}>Export data XML</button>}
        </div>)}
    </div>
  );
}
