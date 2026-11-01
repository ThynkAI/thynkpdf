"use client";
import { useEffect, useState } from "react";
import type { XfaSchemaOut } from "@thynkpdf/editor-client";
import { useSession } from "@/lib/session";
import { http, describeError } from "@/lib/documents";
import { classifyXfaError, runXfaOp } from "@/lib/xfaConvert";
import { XfaSchemaForm } from "./XfaSchemaForm";

/** Learned per session: hide server XFA actions once their endpoints answer 404/405. */
export const xfaServerSupport = { schema: true, importXml: true, exportXml: true };

/** Loads GET /pdf/{id}/forms/xfa/schema (if deployed) and renders the schema-driven form. Renders nothing when unavailable. */
export function XfaServerForm() {
  const s = useSession();
  const ref = s.ref;
  const [schema, setSchema] = useState<XfaSchemaOut | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [, force] = useState(0);
  useEffect(() => {
    setSchema(null); setMsg(null);
    if (!ref || s.api.kind !== "http" || !xfaServerSupport.schema) return;
    let live = true;
    http().getXfaSchema(ref.document_id, ref.version).then((sc) => { if (live && Array.isArray(sc?.fields)) setSchema(sc); }, (e) => {
      const c = classifyXfaError(e);
      if (c.outcome === "unavailable") xfaServerSupport.schema = false;
      else if (live) setMsg(c.message ?? `Couldn't read the XFA form fields: ${describeError(e)}`);
    });
    return () => { live = false; };
  }, [ref?.document_id, ref?.version]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!ref || (!schema && !msg)) return null;
  const after = (r: Awaited<ReturnType<typeof runXfaOp>>, k: "importXml" | null, ok: string) => {
    if (r.outcome === "unavailable") { if (k) xfaServerSupport[k] = false; force((n) => n + 1); setMsg("That action isn't available on this server yet."); }
    else if (r.outcome === "known") setMsg(r.message ?? null);
    else if (r.outcome === "ok") setMsg(ok);
  };
  return (
    <div className="mb-2" data-testid="xfa-server-form">
      <p className="mb-1 font-medium">Fields from the form template (server)</p>
      {msg && <p role="status" data-testid="xfa-server-msg" className="text-xs text-neutral-600 dark:text-neutral-400">{msg}</p>}
      {schema && schema.fields.length === 0 && <p className="text-xs text-neutral-500">The server found no fillable fields in the XFA template.</p>}
      {schema && schema.fields.length > 0 && <XfaSchemaForm schema={schema} busy={!!s.busy}
        onSubmit={async (values) => { const r = await runXfaOp("Fill XFA form", (x) => http().fillXfa(x, values)); const miss = (r.report?.missing_required as string[] | undefined) ?? []; after(r, null, miss.length ? `Saved. Required fields still empty: ${miss.join(", ")}` : "Saved as a new version."); }}
        onImportXml={xfaServerSupport.importXml ? async (xml) => { after(await runXfaOp("Import XFA data", (x) => http().importXfaData(x, xml)), "importXml", "Imported data XML (new version)."); } : undefined}
        onExportXml={xfaServerSupport.exportXml ? async () => {
          try {
            const xml = await http().exportXfaData(ref.document_id, ref.version);
            const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([xml], { type: "application/xml" })); a.download = "xfa-data.xml"; a.click();
            setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
          } catch (e) {
            const c = classifyXfaError(e);
            if (c.outcome === "unavailable") { xfaServerSupport.exportXml = false; force((n) => n + 1); setMsg("Export isn't available on this server yet."); }
            else setMsg(c.message ?? `Export failed: ${describeError(e)}`);
          }
        } : undefined} />}
    </div>
  );
}
