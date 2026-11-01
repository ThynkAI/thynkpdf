"use client";
import { useEffect, useState } from "react";
import { useViewerStore } from "@thynkpdf/pdf-viewer";
import { useSession } from "@/lib/session";
import { currentBytes, saveModifiedCopy } from "@/lib/copies";
import { listFields, fillFieldsWithReport, addField, XFA_REMOVED_NOTE, type FieldInfo } from "@/lib/pdfWrite";
import { XfaFormBanner } from "./XfaFormBanner";
import { saveXfaDocument } from "@thynkpdf/pdf-viewer/client";
import { describeError, http, runVersionedOp } from "@/lib/documents";

export function FormsPanel() {
  const { docKey, currentPage, pageSizes, xfa, doc } = useViewerStore();
  const [note, setNote] = useState<string | null>(null);
  const s = useSession();
  const [fields, setFields] = useState<FieldInfo[] | null>(null);
  const [vals, setVals] = useState<Record<string, string | boolean>>({});
  const [err, setErr] = useState<string | null>(null);
  const [newName, setNewName] = useState(""); const [newType, setNewType] = useState<"text" | "checkbox">("text");
  const [confirmFlat, setConfirmFlat] = useState(false);
  const [missing, setMissing] = useState<string[]>([]);
  // Server documents use the versioned forms API (fields/fill/flatten → new version); local files use pdf-lib in the browser.
  const server = !!s.ref && s.api.kind === "http";
  useEffect(() => {
    setFields(null); setVals({}); setErr(null); setConfirmFlat(false); setNote(null);
    if (!pageSizes.length) return;
    let live = true;
    const ref = s.ref;
    const load: Promise<FieldInfo[]> = server && ref
      ? http().listForms(ref.document_id, ref.version).then((r) => r.fields.map((f) => ({ name: f.name, type: (f.type === "listbox" ? "dropdown" : f.type) as FieldInfo["type"], value: (Array.isArray(f.value) ? f.value[0] : f.value) as string | boolean ?? "", options: f.options ?? undefined, readOnly: f.read_only, required: f.required, hasActions: f.has_actions })))
      : currentBytes().then(listFields);
    load.then((f) => { if (live) setFields(f); }, (e) => { if (live) setErr(describeError(e)); });
    return () => { live = false; };
  }, [docKey, s.ref?.version]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!pageSizes.length) return null;
  if (xfa === "pure") return (
    <section aria-labelledby="forms-h" data-testid="xfa-forms">
      <h2 id="forms-h" className="mb-1 font-semibold">Form fields (XFA)</h2>
      <XfaFormBanner mode={xfa} />
      <p className="text-xs text-neutral-600 dark:text-neutral-400">This is a dynamic XFA form. Type directly into the fields on the page, then save. Values are written into the form&apos;s XFA data, so Adobe Reader shows them too. Form scripts are not run.</p>
      <button className="mt-1 rounded bg-brand-600 px-3 py-1 text-xs text-white disabled:opacity-40" disabled={!doc || !!s.busy} onClick={async () => {
        if (!doc) return;
        try { await saveModifiedCopy(await saveXfaDocument(doc), "filled"); } catch (x) { s.set({ error: `Save failed: ${describeError(x)}` }); }
      }}>{server ? "Save values (new version)" : "Save filled copy"}</button>
    </section>);
  const input = "w-full rounded border px-2 py-1 dark:border-neutral-700 dark:bg-neutral-800";
  return (
    <section aria-labelledby="forms-h">
      <h2 id="forms-h" className="mb-1 font-semibold">Form fields</h2>
      <XfaFormBanner mode={xfa} />
      {err && <p role="alert" className="text-xs text-red-600">{err}</p>}
      {fields === null && !err && <p className="text-xs text-neutral-500">Reading form…</p>}
      {fields && fields.length === 0 && <p className="text-xs text-neutral-500" data-testid="no-fields">This PDF has no form fields.</p>}
      {fields && fields.length > 0 && (
        <form className="space-y-1 text-xs" data-testid="form-fields" onSubmit={async (e) => {
          e.preventDefault();
          if (server) {
            let rep: Record<string, unknown> | null = null;
            const ok = await runVersionedOp("Fill form", async (r) => { const v = await http().fillForm(r, vals); rep = v.report ?? null; return v; });
            if (ok) { setMissing(((rep as { missing_required?: string[] } | null)?.missing_required) ?? []); setVals({}); }
            return;
          }
          try { const r = await fillFieldsWithReport(await currentBytes(), vals); await saveModifiedCopy(r.bytes, "filled"); setNote(r.xfaRemoved ? XFA_REMOVED_NOTE : null); } catch (x) { s.set({ error: `Fill failed: ${describeError(x)}` }); }
        }}>
          {fields.map((f) => {
            const v = vals[f.name] ?? f.value;
            return (
              <label key={f.name} className="block">
                <span className="text-neutral-500">{f.name}{f.required ? " *" : ""}{f.readOnly ? " (read-only)" : ""}{f.hasActions ? " (has scripts — not run)" : ""}</span>
                {f.type === "checkbox" ? <input type="checkbox" className="ml-2" aria-label={f.name} disabled={f.readOnly} checked={!!v} onChange={(e) => setVals({ ...vals, [f.name]: e.target.checked })} />
                  : f.type === "dropdown" || f.type === "radio" ? (
                    <select aria-label={f.name} className={input} disabled={f.readOnly} value={String(v)} onChange={(e) => setVals({ ...vals, [f.name]: e.target.value })}>
                      <option value="">—</option>{f.options?.map((o) => <option key={o}>{o}</option>)}
                    </select>)
                  : f.type === "text" ? <input aria-label={f.name} className={input} disabled={f.readOnly} value={String(v)} onChange={(e) => setVals({ ...vals, [f.name]: e.target.value })} />
                  : <span className="ml-2 text-neutral-500">unsupported field type</span>}
              </label>);
          })}
          <button className="rounded bg-brand-600 px-3 py-1 text-white disabled:opacity-40" disabled={!Object.keys(vals).length || !!s.busy}>{server ? "Save values (new version)" : "Save filled copy"}</button>
          {note && <p role="status" data-testid="xfa-removed-note" className="text-amber-700">{note}</p>}
          {missing.length > 0 && <p role="status" className="text-amber-700">Required fields still empty: {missing.join(", ")}</p>}
        </form>)}
      {server && fields && fields.length > 0 && (!confirmFlat
        ? <button className="mt-1 rounded border px-2 py-1 text-xs dark:border-neutral-700" onClick={() => setConfirmFlat(true)}>Flatten form…</button>
        : <p role="group" aria-label="Confirm flatten" className="mt-1 text-xs">Flatten burns values into the page and removes the fields (earlier versions keep them).{" "}
            <button className="rounded border border-red-400 px-2 py-0.5 text-red-700" onClick={async () => { setConfirmFlat(false); await runVersionedOp("Flatten form", (r) => http().flattenForm(r)); }}>Flatten</button>{" "}
            <button className="underline" onClick={() => setConfirmFlat(false)}>Cancel</button></p>)}
      <form className="mt-2 flex flex-wrap items-center gap-1 text-xs" onSubmit={async (e) => {
        e.preventDefault();
        const sz = pageSizes[currentPage];
        const rect = newType === "text" ? { x: 72, y: sz.height / 2, width: Math.min(220, sz.width - 144), height: 22 } : { x: 72, y: sz.height / 2, width: 16, height: 16 };
        if (server) {
          if (await runVersionedOp("Add field", (r) => http().addFormFields(r, [{ name: newName.trim(), type: newType, page: currentPage + 1, rect: [rect.x, rect.y, rect.x + rect.width, rect.y + rect.height] }]))) setNewName("");
          return;
        }
        try {
          const bytes = await currentBytes();
          await saveModifiedCopy(await addField(bytes, { name: newName.trim(), type: newType, pageIndex: currentPage, rect }), "form");
          setNewName("");
        } catch (x) { s.set({ error: `Add field failed: ${describeError(x)}` }); }
      }}>
        <input aria-label="New field name" placeholder="New field name" value={newName} onChange={(e) => setNewName(e.target.value)} className="min-w-0 flex-1 rounded border px-2 py-1 dark:border-neutral-700 dark:bg-neutral-800" />
        <select aria-label="New field type" value={newType} onChange={(e) => setNewType(e.target.value as "text" | "checkbox")} className="rounded border py-1 dark:bg-neutral-800"><option value="text">Text</option><option value="checkbox">Checkbox</option></select>
        <button className="rounded border px-2 py-1 disabled:opacity-40 dark:border-neutral-700" disabled={!newName.trim() || !!s.busy}>Add to page {currentPage + 1}</button>
      </form>
      <p className="mt-1 text-[11px] text-neutral-500">{server ? "Server document: changes are saved as a new version. PDF JavaScript is never executed." : "Local file: fields are written with pdf-lib in your browser."}</p>
    </section>
  );
}
