"use client";
import { useRef, useState } from "react";
import type { XfaSchema, XfaNode, XfaField } from "@thynkpdf/editor-client";

export interface XfaSchemaFormProps {
  schema: XfaSchema;
  busy?: boolean;
  onSubmit(values: Record<string, string | boolean>): void | Promise<void>;
  /** Omit to hide the action (endpoint not available). */
  onImportXml?(file: File): void | Promise<void>;
  onExportXml?(): void | Promise<void>;
}

const input = "w-full rounded border px-2 py-1 dark:border-neutral-700 dark:bg-neutral-800";

/** Schema-driven fill form for dynamic XFA (server-parsed template). PDF.js rendering stays the primary view. */
export function XfaSchemaForm({ schema, busy, onSubmit, onImportXml, onExportXml }: XfaSchemaFormProps) {
  const [vals, setVals] = useState<Record<string, string | boolean>>({});
  const fileRef = useRef<HTMLInputElement>(null);
  const set = (som: string, v: string | boolean) => setVals((p) => ({ ...p, [som]: v }));

  const field = (f: XfaField) => {
    const label = f.caption || f.name;
    const v = vals[f.som] ?? f.value ?? (f.type === "checkbox" ? false : "");
    const ro = !!f.read_only;
    const meta = `${f.required ? " *" : ""}${ro ? " (read-only)" : ""}${f.has_scripts ? " (has scripts — not run)" : ""}`;
    let control;
    switch (f.type) {
      case "checkbox": control = <input type="checkbox" className="ml-2" aria-label={label} disabled={ro} checked={!!v} onChange={(e) => set(f.som, e.target.checked)} />; break;
      case "radio": case "choice":
        control = <select aria-label={label} className={input} disabled={ro} value={String(v)} onChange={(e) => set(f.som, e.target.value)}><option value="">—</option>{f.options?.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select>; break;
      case "multiline": control = <textarea aria-label={label} className={input} disabled={ro} maxLength={f.max_chars ?? undefined} value={String(v)} onChange={(e) => set(f.som, e.target.value)} />; break;
      case "text": case "numeric": case "date":
        control = <input aria-label={label} className={input} disabled={ro} inputMode={f.type === "numeric" ? "decimal" : undefined} type={f.type === "date" ? "date" : "text"} maxLength={f.max_chars ?? undefined} value={String(v)} onChange={(e) => set(f.som, e.target.value)} />; break;
      default: control = <span className="ml-2 text-neutral-500">{f.type} field — not editable here</span>;
    }
    return <label key={f.som} className="block" data-som={f.som}><span className="text-neutral-500">{label}{meta}</span>{control}</label>;
  };
  const node = (n: XfaNode, depth: number): React.ReactNode => n.kind === "field" ? field(n) : (
    <fieldset key={n.som} className={depth ? "rounded border border-neutral-200 p-1 dark:border-neutral-700" : ""} data-som={n.som}>
      {depth > 0 && <legend className="px-1 font-medium">{n.caption || n.name}{n.repeatable ? " (repeatable)" : ""}</legend>}
      <div className="space-y-1">{n.children.map((c) => node(c, depth + 1))}</div>
    </fieldset>);

  return (
    <div data-testid="xfa-schema-form" className="text-xs">
      {schema.has_scripts && <p className="mb-1 text-amber-700">This form has scripts (calculations/validation); they are not run.</p>}
      <form className="space-y-1" onSubmit={(e) => { e.preventDefault(); void onSubmit(vals); }}>
        {node(schema.root, 0)}
        <button className="rounded bg-brand-600 px-3 py-1 text-white disabled:opacity-40" disabled={!Object.keys(vals).length || busy}>Save values (new version)</button>
      </form>
      {(onImportXml || onExportXml) && (
        <div className="mt-1 flex gap-1">
          {onImportXml && <>
            <button type="button" className="rounded border px-2 py-1 dark:border-neutral-700" disabled={busy} onClick={() => fileRef.current?.click()}>Import data XML</button>
            <input ref={fileRef} type="file" accept=".xml,application/xml,text/xml" hidden data-testid="xfa-xml-input" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void onImportXml(f); }} />
          </>}
          {onExportXml && <button type="button" className="rounded border px-2 py-1 dark:border-neutral-700" disabled={busy} onClick={() => void onExportXml()}>Export data XML</button>}
        </div>)}
    </div>
  );
}
