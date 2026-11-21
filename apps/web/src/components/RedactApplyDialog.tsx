"use client";
import { useEffect, useRef, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { useViewerStore } from "@thynkpdf/pdf-viewer";
import type { SanitizeOptions } from "@thynkpdf/editor-client";
import { useRedact, applyRedactions, summary, DEFAULT_SANITIZE } from "@/lib/redact";

const SAN: { k: keyof SanitizeOptions; label: string }[] = [
  { k: "metadata", label: "Metadata (author, title, XMP, private app data, thumbnails)" },
  { k: "javascript", label: "JavaScript and launch/submit actions" },
  { k: "attachments", label: "Embedded files / attachments" },
  { k: "comments", label: "Comments and markups" },
  { k: "forms", label: "Form fields (flattened — values stay visible)" },
  { k: "hidden_text", label: "Invisible text (e.g. OCR layer of scans — the copy is no longer searchable)" },
];

/** Final confirmation. Irreversible in the output file, so it requires an explicit checkbox; default saves a NEW file. */
export function RedactApplyDialog({ onClose }: { onClose(): void }) {
  const marks = useRedact((r) => r.marks);
  const base = (useViewerStore.getState().fileName ?? "document.pdf").replace(/ \(v\d+\)$/, "").replace(/\.pdf$/i, "");
  const [fill, setFill] = useState<"black" | "none">("black");
  const [hidden, setHidden] = useState(true); // safer default: a redacted copy should not keep metadata, scripts or attachments
  const [san, setSan] = useState<Required<SanitizeOptions>>({ ...DEFAULT_SANITIZE });
  const [output, setOutput] = useState<"new_document" | "new_version">("new_document");
  const [name, setName] = useState(`${base}-redacted.pdf`);
  const [ack, setAck] = useState(false); const [running, setRunning] = useState(false);
  const first = useRef<HTMLButtonElement>(null);
  useEffect(() => { first.current?.focus(); const k = (e: KeyboardEvent) => { if (e.key === "Escape" && !running) onClose(); }; window.addEventListener("keydown", k); return () => window.removeEventListener("keydown", k); }, [onClose, running]);
  const can = ack && (marks.length > 0 || hidden) && !running && (output === "new_version" || name.trim().length > 0);
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/50 p-4" onMouseDown={(e) => { if (e.target === e.currentTarget && !running) onClose(); }}>
      <div role="dialog" aria-modal="true" aria-labelledby="rd-dlg-h" data-testid="redact-dialog" className="w-full max-w-md rounded-xl bg-white p-4 text-sm shadow-xl dark:bg-neutral-900">
        <h2 id="rd-dlg-h" className="mb-2 text-base font-semibold">{marks.length ? "Apply redactions" : "Remove hidden information"}</h2>
        <div role="alert" className="mb-3 flex gap-2 rounded-md border border-[#E8141C]/40 bg-[#E8141C]/10 p-2 text-xs text-neutral-900 dark:text-neutral-100">
          <AlertTriangle aria-hidden className="h-4 w-4 shrink-0 text-[#E8141C]" />
          <p>{marks.length ? <>This <strong>permanently removes</strong> the text, images and drawings under {summary(marks)}. The removed content cannot be recovered from the redacted file.</> : <>The selected hidden information is permanently removed from the saved copy.</>}</p>
        </div>
        {marks.length > 0 && (
          <fieldset className="mb-3"><legend className="mb-1 text-xs font-semibold">Redacted areas</legend>
            <label className="mr-3 text-xs"><input type="radio" name="rd-fill" checked={fill === "black"} onChange={() => setFill("black")} /> Black box</label>
            <label className="text-xs"><input type="radio" name="rd-fill" checked={fill === "none"} onChange={() => setFill("none")} /> No fill (leave blank)</label>
          </fieldset>)}
        <fieldset className="mb-3">
          <label className="text-xs font-semibold"><input type="checkbox" checked={hidden} onChange={(e) => setHidden(e.target.checked)} data-testid="redact-hidden" /> Also remove hidden information</label>
          {hidden && <ul className="ml-5 mt-1 space-y-0.5">{SAN.map(({ k, label }) => (
            <li key={k}><label className="text-[11px]"><input type="checkbox" checked={san[k]} onChange={(e) => setSan({ ...san, [k]: e.target.checked })} /> {label}</label></li>))}</ul>}
        </fieldset>
        <fieldset className="mb-3"><legend className="mb-1 text-xs font-semibold">Save</legend>
          <label className="block text-xs"><input type="radio" name="rd-out" checked={output === "new_document"} onChange={() => setOutput("new_document")} /> As a new file (recommended — the original stays unchanged)</label>
          {output === "new_document" && <input aria-label="New file name" value={name} onChange={(e) => setName(e.target.value)} className="my-1 ml-5 w-[calc(100%-1.25rem)] rounded border border-neutral-300 px-2 py-0.5 text-xs dark:border-neutral-700 dark:bg-neutral-800" />}
          <label className="block text-xs"><input type="radio" name="rd-out" checked={output === "new_version"} onChange={() => setOutput("new_version")} /> As a new version of this document</label>
          {output === "new_version" && <p className="ml-5 text-[11px] text-amber-700 dark:text-amber-400">Earlier versions in Documents → Versions still contain the original content.</p>}
        </fieldset>
        <label className="mb-3 block text-xs"><input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} data-testid="redact-ack" /> I understand this cannot be undone in the saved file.</label>
        <div className="flex justify-end gap-2">
          <button ref={first} className="rounded border px-3 py-1 dark:border-neutral-700" onClick={onClose} disabled={running}>Cancel</button>
          <button className="rounded bg-[#E8141C] px-3 py-1 font-semibold text-white disabled:opacity-40" disabled={!can} data-testid="redact-confirm"
            onClick={async () => { setRunning(true); const r = await applyRedactions({ fill, sanitize: hidden ? san : null, output, filename: output === "new_document" ? name.trim() : undefined }); setRunning(false); if (r) onClose(); }}>
            {running ? "Applying…" : marks.length ? "Apply redactions" : "Remove information"}</button>
        </div>
      </div>
    </div>
  );
}
