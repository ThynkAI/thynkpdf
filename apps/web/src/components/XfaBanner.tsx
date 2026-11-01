"use client";
import { useState } from "react";
import { useViewerStore } from "@thynkpdf/pdf-viewer";

/** Honest status for XFA forms: what we rendered and what we could not. Never claims more than PDF.js did. */
export function XfaBanner() {
  const xfa = useViewerStore((s) => s.xfa);
  const docKey = useViewerStore((s) => s.docKey);
  const [hidden, setHidden] = useState(-1);
  if (xfa === "none" || hidden === docKey) return null;
  const text = xfa === "pure"
    ? "Dynamic XFA form: rendered with the built-in XFA engine and fillable here. Form scripts (calculations, validation, show/hide) are not run, and annotations, signatures and page edits don't appear on XFA pages."
    : xfa === "hybrid"
      ? "This form contains XFA plus a standard AcroForm. Showing the AcroForm version; some dynamic XFA layout may differ from Adobe Reader."
      : "This document is an XFA form that could not be fully rendered here, so only its placeholder page is shown. Open it in Adobe Acrobat Reader to view or fill the full form.";
  return (
    <div role={xfa === "unrendered" ? "alert" : "status"} data-testid="xfa-banner" data-xfa={xfa}
      className={`absolute inset-x-0 top-0 z-10 border-b px-3 py-1.5 text-xs ${xfa === "unrendered" ? "border-amber-300 bg-amber-50 text-amber-900 dark:bg-amber-950 dark:text-amber-200" : "border-sky-200 bg-sky-50 text-sky-900 dark:bg-sky-950 dark:text-sky-200"}`}>
      {text}
      <button className="ml-2 underline" onClick={() => setHidden(docKey)} aria-label="Dismiss XFA notice">Dismiss</button>
    </div>
  );
}
