"use client";
import { useEffect, useState } from "react";
import type { XfaSchema } from "@thynkpdf/editor-client";
import { useSession } from "@/lib/session";
import { http, runVersionedOp, describeError } from "@/lib/documents";
import { classifyConvertError } from "@/lib/xfaConvert";
import { XfaSchemaForm } from "./XfaSchemaForm";

/** Learned per session: hide server XFA actions once their endpoints answer 404/405. */
export const xfaServerSupport = { schema: true, importXml: true, exportXml: true };

/** Loads the backend's dynamic-XFA schema (if deployed) and renders the schema-driven form. Renders nothing otherwise. */
export function XfaServerForm() {
  const s = useSession();
  const ref = s.ref;
  const [schema, setSchema] = useState<XfaSchema | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [, force] = useState(0);
  useEffect(() => {
    setSchema(null); setMsg(null);
    if (!ref || s.api.kind !== "http" || !xfaServerSupport.schema) return;
    let live = true;
    http().getXfaSchema(ref.document_id, ref.version).then((sc) => { if (live && sc?.root) setSchema(sc); }, (e) => {
      if (classifyConvertError(e) === "unavailable") xfaServerSupport.schema = false;
      else if (live) setMsg(`Couldn't read the XFA schema: ${describeError(e)}`);
    });
    return () => { live = false; };
  }, [ref?.document_id, ref?.version]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!ref || (!schema && !msg)) return null;
  const unavailable = (e: unknown, k: "importXml" | "exportXml") => { if (classifyConvertError(e) === "unavailable") { xfaServerSupport[k] = false; force((n) => n + 1); setMsg("That action isn't available on this server yet."); return true; } return false; };
  return (
    <div className="mb-2" data-testid="xfa-server-form">
      <p className="mb-1 font-medium">Fields from the form template (server)</p>
      {msg && <p role="status" className="text-xs text-neutral-500">{msg}</p>}
      {schema && <XfaSchemaForm schema={schema} busy={!!s.busy}
        onSubmit={async (values) => { await runVersionedOp("Fill XFA form", (r) => http().fillXfa(r, values)); }}
        onImportXml={xfaServerSupport.importXml ? async (file) => {
          let err: unknown = null;
          await runVersionedOp("Import XFA data", async (r) => { try { return await http().importXfaData(r, file); } catch (e) { err = e; throw e; } });
          if (err && unavailable(err, "importXml")) useSession.getState().set({ error: null });
        } : undefined}
        onExportXml={xfaServerSupport.exportXml ? async () => {
          try {
            const xml = await http().exportXfaData(ref.document_id, ref.version);
            const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([xml], { type: "application/xml" })); a.download = "form-data.xml"; a.click();
            setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
          } catch (e) { if (!unavailable(e, "exportXml")) setMsg(`Export failed: ${describeError(e)}`); }
        } : undefined} />}
    </div>
  );
}
