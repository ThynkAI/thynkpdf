"use client";
import { useState } from "react";
import type { XfaMode } from "@thynkpdf/pdf-viewer";
import { useSession } from "@/lib/session";
import { convertXfaToStandardForm, xfaConvertSupport, describeConvertReport } from "@/lib/xfaConvert";

const LABEL: Record<Exclude<XfaMode, "none">, string> = {
  pure: "Dynamic XFA form",
  hybrid: "Hybrid form (XFA + standard AcroForm)",
  unrendered: "Dynamic XFA form (could not be rendered here)",
};

/** Forms-tool banner: form type + optional server-side "Convert to standard form" (hidden when the endpoint isn't deployed). */
export function XfaFormBanner({ mode }: { mode: XfaMode }) {
  const s = useSession();
  const [msg, setMsg] = useState<string | null>(null);
  const [, force] = useState(0);
  if (mode === "none") return null;
  const server = !!s.ref && s.api.kind === "http";
  return (
    <div data-testid="xfa-form-banner" data-xfa={mode} className="mb-2 rounded border border-sky-200 bg-sky-50 p-2 text-xs text-sky-900 dark:bg-sky-950 dark:text-sky-200">
      <p className="font-medium">{LABEL[mode]}</p>
      {server && xfaConvertSupport.available && (
        <button className="mt-1 rounded border border-sky-400 px-2 py-0.5 disabled:opacity-40" disabled={!!s.busy} onClick={async () => {
          setMsg(null);
          const r = await convertXfaToStandardForm();
          if (r.outcome === "unavailable") { setMsg("Converting on the server isn't available yet."); force((n) => n + 1); }
          else if (r.outcome === "known") setMsg(r.message ?? null);
          else if (r.outcome === "ok") setMsg(describeConvertReport(r.report));
        }}>Convert to standard form</button>
      )}
      {msg && <p role="status" data-testid="xfa-convert-msg" className="mt-1">{msg}</p>}
    </div>
  );
}
