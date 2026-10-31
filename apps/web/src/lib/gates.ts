import type { Capabilities, DocumentRef } from "@thynkpdf/editor-client";

export type EditAction = "rotate" | "reorder" | "delete" | "duplicate" | "insert_blank";
export interface Gate { enabled: boolean; reason: string | null }

/** Decide whether an edit action is available, with a human reason when it is not. Pure; unit-tested. */
export function editGate(action: EditAction, ref: DocumentRef | null, caps: Capabilities | null, opts: { busy?: boolean; capsError?: string | null } = {}): Gate {
  const no = (reason: string): Gate => ({ enabled: false, reason });
  if (!ref) return no("Editing requires a document opened through the THYNKPDF server (sign in, then open).");
  if (opts.busy) return no("Another operation is in progress.");
  if (opts.capsError) return no(`Could not check edit capabilities: ${opts.capsError}`);
  if (!caps || caps.document_id !== ref.document_id || caps.version !== ref.version) return no("Checking what can be edited…");
  if (!caps.page_ops[action]) {
    const why = caps.document_limitations.map((l) => l.message).join(" ");
    return no(why || `This document does not allow ${action.replace("_", " ")}.`);
  }
  return { enabled: true, reason: null };
}

export function textEditGate(page: number, ref: DocumentRef | null, caps: Capabilities | null, opts: { busy?: boolean; capsError?: string | null } = {}): Gate {
  const base = editGate("rotate", ref, caps, opts);
  if (!base.enabled && (!ref || opts.busy || opts.capsError || !caps || caps.version !== ref.version)) return base;
  if (!caps!.text_replace) return { enabled: false, reason: caps!.document_limitations.map((l) => l.message).join(" ") || "Text editing is not available for this document." };
  const p = caps!.pages.find((x) => x.number === page);
  if (!p?.text_replace) return { enabled: false, reason: p?.limitations.map((l) => l.message).join(" ") || `Page ${page} has no editable text.` };
  return { enabled: true, reason: null };
}
