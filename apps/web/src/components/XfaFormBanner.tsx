"use client";
import { useEffect, useState } from "react";
import type { XfaMode } from "@thynkpdf/pdf-viewer";
import { useSession } from "@/lib/session";
import { convertXfaToStandardForm, xfaConvertSupport, describeConvertReport, getXfaCapabilities } from "@/lib/xfaConvert";

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
  // /capabilities xfa.convert (null = older server: keep the 404/405 fallback).
  const [canConvert, setCanConvert] = useState<boolean | null>(null);
  const server = !!s.ref && s.api.kind === "http";
  useEffect(() => {
    setCanConvert(null);
    if (!server || !s.ref || mode === "none") return;
    let live = true;
    getXfaCapabilities(s.ref.document_id, s.ref.version).then((c) => { if (live && c) setCanConvert(!!c.convert); });
    return () => { live = false; };
  }, [server, s.ref?.document_id, s.ref?.version, mode]); // eslint-disable-line react-hooks/exhaustive-deps
  if (mode === "none") return null;
  return (
    <div data-testid="xfa-form-banner" data-xfa={mode} className="mb-2 rounded border border-neutral-200 border-l-4 border-l-brand-600 bg-paper p-2 text-xs text-neutral-900 dark:border-neutral-800 dark:border-l-brand-500 dark:bg-neutral-900 dark:text-neutral-100">
      <p className="font-medium">{LABEL[mode]}</p>
      {server && xfaConvertSupport.available && canConvert !== false && (
        <button className="mt-1 rounded border border-brand-600 px-2 py-0.5 font-medium text-brand-700 hover:bg-brand-500/10 dark:border-brand-400 dark:text-brand-300 disabled:opacity-40" disabled={!!s.busy} onClick={async () => {
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
