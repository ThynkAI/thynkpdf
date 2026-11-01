"use client";
import { useId, useRef, useState } from "react";
import { groupXfaFields, xfaGroupTitle, xfaLeafName, xfaCloneInstance, type XfaSchemaOut, type XfaSchemaField, type XfaGroup, type XfaImportMode } from "@thynkpdf/editor-client";

export interface XfaSchemaFormProps {
  schema: Pick<XfaSchemaOut, "fields" | "warnings" | "scripts_ignored"> & { xfa?: { has_scripts?: boolean } };
  busy?: boolean;
  onSubmit(values: Record<string, string | boolean>): void | Promise<void>;
  /** Omit to hide the action (endpoint not available). mode defaults to "merge". */
  onImportXml?(xml: string, mode: XfaImportMode): void | Promise<void>;
  onExportXml?(): void | Promise<void>;
}

const input = "w-full rounded border px-2 py-1 dark:border-neutral-700 dark:bg-neutral-800";
const label = (s: string) => s.replace(/[_-]+/g, " ");
const initial = (f: XfaSchemaField): string | boolean => f.type === "checkbox" ? (f.value === true || (f.on_value != null ? String(f.value) === f.on_value : String(f.value ?? "") === "1")) : f.value == null ? "" : String(f.value);
/** Key identifying a repeatable subform across its instances (section SOM without the last index). */
const repeatKey = (g: XfaGroup) => g.path.replace(/\[\d+\]$/, "");

/** Schema-driven fill form for XFA (GET /pdf/{id}/forms/xfa/schema): sections with captions, repeat instances, tooltips. */
export function XfaSchemaForm({ schema, busy, onSubmit, onImportXml, onExportXml }: XfaSchemaFormProps) {
  const [vals, setVals] = useState<Record<string, string | boolean>>({});
  /** Instances added client-side, per repeatable subform. */
  const [added, setAdded] = useState<Record<string, XfaGroup[]>>({});
  const [mode, setMode] = useState<XfaImportMode>("merge");
  const fileRef = useRef<HTMLInputElement>(null);
  const uid = useId();
  const set = (k: string, v: string | boolean) => setVals((p) => ({ ...p, [k]: v }));
  const tree = groupXfaFields(schema.fields);

  const field = (f: XfaSchemaField) => {
    const text = f.caption || label(xfaLeafName(f));
    const key = f.name; // fill key (data path, indexed for repeats); unbound fields can't be filled
    const ro = f.read_only || !key;
    const v = key && key in vals ? vals[key] : initial(f);
    const meta = `${f.required ? " *" : ""}${f.read_only ? " (read-only)" : ""}${!key ? " (not bound to data)" : ""}`;
    const opts = (f.options ?? []).map((o, i) => ({ value: o, label: f.option_captions?.[i] ?? o }));
    const tipId = f.tooltip ? `${uid}-tip-${f.som}` : undefined;
    const common = { "aria-label": text, "aria-describedby": tipId, title: f.tooltip ?? undefined, disabled: ro };
    let control;
    switch (f.type) {
      case "checkbox": control = <input type="checkbox" className="ml-2" {...common} checked={!!v} onChange={(e) => key && set(key, e.target.checked)} />; break;
      case "radio": case "choice":
        control = <select {...common} className={input} value={String(v)} onChange={(e) => key && set(key, e.target.value)}><option value="">—</option>{opts.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select>; break;
      case "text": case "numeric": case "date": case "password":
        control = f.multiline
          ? <textarea {...common} className={input} maxLength={f.max_chars ?? undefined} value={String(v)} onChange={(e) => key && set(key, e.target.value)} />
          : <input {...common} className={input} type={f.type === "password" ? "password" : "text"} inputMode={f.type === "numeric" ? "decimal" : undefined} placeholder={f.type === "date" ? "date" : undefined} maxLength={f.max_chars ?? undefined} value={String(v)} onChange={(e) => key && set(key, e.target.value)} />; break;
      default: control = <span className="ml-2 text-neutral-500">{f.type} field — not editable here</span>;
    }
    return <label key={f.som} className="block" data-som={f.som}>
      <span className="text-neutral-500">{text}{meta}</span>{control}
      {f.tooltip && <span id={tipId} className="block text-[11px] text-neutral-400" data-testid="xfa-tooltip">{f.tooltip}</span>}
    </label>;
  };

  const group = (g: XfaGroup, depth: number, count?: number): React.ReactNode => {
    const rep = g.occur && g.instance != null;
    const title = xfaGroupTitle(g) + (rep && (count ?? 1) > 1 ? ` (${g.instance! + 1} of ${count})` : "");
    return (
      <fieldset key={g.path || "root"} className={depth ? "rounded border border-neutral-200 p-1 dark:border-neutral-700" : ""} data-path={g.path} data-instance={rep ? g.instance! : undefined}>
        {depth > 0 && <legend className="px-1 font-medium">{title}</legend>}
        <div className="space-y-1">{g.fields.map(field)}{children(g, depth)}</div>
      </fieldset>);
  };
  /** Render child sections; consecutive instances of a repeatable subform get an "Add" button (respecting occur.max). */
  const children = (g: XfaGroup, depth: number): React.ReactNode[] => {
    const out: React.ReactNode[] = [];
    const seen = new Set<string>();
    for (const c of g.groups) {
      if (!c.occur || c.instance == null) { out.push(group(c, depth + 1)); continue; }
      const k = repeatKey(c);
      if (seen.has(k)) continue;
      seen.add(k);
      const inst = [...g.groups.filter((x) => x.occur && repeatKey(x) === k), ...(added[k] ?? [])];
      const max = c.occur.max;
      inst.forEach((x) => out.push(group(x, depth + 1, inst.length)));
      const last = inst[inst.length - 1];
      const name = xfaGroupTitle(c);
      if (max === -1 || inst.length < max) out.push(
        <button key={`${k}-add`} type="button" className="rounded border px-2 py-0.5 dark:border-neutral-700" disabled={busy}
          onClick={() => setAdded((p) => ({ ...p, [k]: [...(p[k] ?? []), xfaCloneInstance(last, (last.instance ?? 0) + 1)] }))}>+ Add {name}</button>);
      else out.push(<p key={`${k}-max`} className="text-[11px] text-neutral-400">Maximum of {max} {name} reached.</p>);
    }
    return out;
  };

  return (
    <div data-testid="xfa-schema-form" className="text-xs">
      {(schema.scripts_ignored > 0 || schema.xfa?.has_scripts) && <p className="mb-1 text-amber-700">This form has scripts{schema.scripts_ignored ? ` (${schema.scripts_ignored})` : ""} for calculations/validation; they are not run.</p>}
      {schema.warnings?.length > 0 && <ul className="mb-1 list-disc pl-4 text-neutral-500">{schema.warnings.map((w) => <li key={w}>{w}</li>)}</ul>}
      <form className="space-y-1" onSubmit={(e) => { e.preventDefault(); void onSubmit(vals); }}>
        {group(tree, 0)}
        <button className="rounded bg-brand-600 px-3 py-1 text-white disabled:opacity-40" disabled={!Object.keys(vals).length || busy}>Save values (new version)</button>
      </form>
      {(onImportXml || onExportXml) && (
        <div className="mt-1 flex flex-wrap items-center gap-1">
          {onImportXml && <>
            <select aria-label="Import mode" className="rounded border px-1 py-1 dark:border-neutral-700 dark:bg-neutral-800" value={mode} onChange={(e) => setMode(e.target.value as XfaImportMode)} disabled={busy}>
              <option value="merge">Merge (only values in the XML change)</option>
              <option value="replace">Replace (clear values not in the XML)</option>
            </select>
            <button type="button" className="rounded border px-2 py-1 dark:border-neutral-700" disabled={busy} onClick={() => fileRef.current?.click()}>Import data XML</button>
            <input ref={fileRef} type="file" accept=".xml,application/xml,text/xml" hidden data-testid="xfa-xml-input" onChange={async (e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) await onImportXml(await f.text(), mode); }} />
          </>}
          {onExportXml && <button type="button" className="rounded border px-2 py-1 dark:border-neutral-700" disabled={busy} onClick={() => void onExportXml()}>Export data XML</button>}
        </div>)}
    </div>
  );
}
