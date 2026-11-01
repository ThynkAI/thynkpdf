import type { Capabilities, DocumentRef } from "@thynkpdf/editor-client";

export type EditAction = "rotate" | "reorder" | "delete" | "duplicate" | "insert_blank";
export interface Gate { enabled: boolean; reason: string | null }

/** Decide whether an edit action is available, with a human reason when it is not. Pure; unit-tested. */
export function editGate(action: EditAction, ref: DocumentRef | null, caps: Capabilities | null, opts: { busy?: boolean; capsError?: string | null; readOnly?: boolean } = {}): Gate {
  const no = (reason: string): Gate => ({ enabled: false, reason });
  if (opts.busy) return no("Another operation is in progress.");
  if (opts.readOnly) return no("You are viewing an older version (read-only). Restore it as a new version to edit.");
  // No server document: page operations run in the browser with pdf-lib (offline, no sign-in needed).
  if (!ref) return { enabled: true, reason: null };
  if (opts.capsError) return no(`Could not check edit capabilities: ${opts.capsError}`);
  if (!caps || caps.document_id !== ref.document_id || caps.version !== ref.version) return no("Checking what can be edited…");
  if (!caps.page_ops[action]) {
    const why = caps.document_limitations.map((l) => l.message).join(" ");
    return no(why || `This document does not allow ${action.replace("_", " ")}.`);
  }
  return { enabled: true, reason: null };
}

export function textEditGate(page: number, ref: DocumentRef | null, caps: Capabilities | null, opts: { busy?: boolean; capsError?: string | null } = {}): Gate {
  if (!ref) return { enabled: false, reason: "Text replacement runs in the THYNKPDF engine; it is not available for this offline copy." };
  const base = editGate("rotate", ref, caps, opts);
  if (!base.enabled && (!ref || opts.busy || opts.capsError || !caps || caps.version !== ref.version)) return base;
  if (!caps!.text_replace) return { enabled: false, reason: caps!.document_limitations.map((l) => l.message).join(" ") || "Text editing is not available for this document." };
  const p = caps!.pages.find((x) => x.number === page);
  if (!p?.text_replace) return { enabled: false, reason: p?.limitations.map((l) => l.message).join(" ") || `Page ${page} has no editable text.` };
  return { enabled: true, reason: null };
}

/** An older server version opened for viewing: no server ref and no local bytes to edit. */
export const readOnlyView = (st: { ref: DocumentRef | null; source: string }) => !st.ref && (st.source === "backend" || st.source === "mock");
